import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { workspaceAccess, permit, ticketAccess } from "./access.js";
import { Connector, Contact } from "./models.js";
import { decrypt } from "./connectors.js";
import { validate, fail } from "./validation.js";
export async function orderContext(workspace, ticket, input, fetcher = fetch) {
  if (ticket.guest && !ticket.guestVerified)
    throw fail("Verify the guest customer before loading order context", 409);
  const contact = await Contact.findOne({ _id: ticket.contact, workspace });
  if (!contact) throw fail("Customer not found", 404);
  const result = { orders: [], tracking: null };
  if (input.order) {
    const connector = await Connector.findOne({
      workspace,
      kind: "shopify",
      enabled: true,
    }).select("+token");
    if (connector) {
      const response = await fetcher(
        `https://${connector.config.shopDomain}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": decrypt(connector.token),
          },
          body: JSON.stringify({
            query:
              "query Orders($search:String!){orders(first:5,query:$search){nodes{id name email displayFulfillmentStatus displayFinancialStatus fulfillments{trackingInfo{company number url}}}}}",
            variables: { search: `name:${input.order}` },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw fail(`Shopify request failed (${response.status})`, 502);
      const data = await response.json();
      if (data.errors)
        throw fail(
          "Shopify access failed. Check order and protected-customer-data permissions.",
          502,
        );
      result.orders = (data.data?.orders?.nodes || [])
        .filter(
          (order) => order.email?.toLowerCase() === contact.email.toLowerCase(),
        )
        .map((order) => ({
          id: order.id,
          name: order.name,
          fulfillmentStatus: order.displayFulfillmentStatus,
          paymentStatus: order.displayFinancialStatus,
          tracking: order.fulfillments.flatMap(
            (fulfillment) => fulfillment.trackingInfo,
          ),
        }));
    }
  }
  if (input.awb) {
    const connector = await Connector.findOne({
      workspace,
      kind: "shiprocket",
      enabled: true,
    }).select("+token");
    if (connector) {
      const response = await fetcher(
        `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${encodeURIComponent(input.awb)}`,
        {
          headers: { Authorization: `Bearer ${decrypt(connector.token)}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw fail(`Shiprocket request failed (${response.status})`, 502);
      const data = await response.json(),
        tracking = data.tracking_data || {};
      result.tracking = {
        status:
          tracking.shipment_track?.[0]?.current_status ||
          tracking.shipment_status,
        estimatedDelivery: tracking.etd,
        trackingUrl: tracking.track_url,
        activities: (tracking.shipment_track_activities || [])
          .slice(0, 20)
          .map((item) => ({
            date: item.date,
            activity: item.activity,
            location: item.location,
          })),
      };
    }
  }
  return result;
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/tickets/:ticketId/order-context",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const input = validate(
        Joi.object({
          order: Joi.string().pattern(/^#?[a-zA-Z0-9_-]{1,50}$/),
          awb: Joi.string().pattern(/^[a-zA-Z0-9_-]{1,50}$/),
        }).min(1),
        req.query,
      ),
      ticket = await ticketAccess(req, req.params.ticketId);
    res.json(await orderContext(req.workspace._id, ticket, input));
  }),
);
export default router;
