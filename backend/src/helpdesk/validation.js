import Joi from "joi";
export const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
export const oid = Joi.string().hex().length(24);
export function validate(schema, value) {
  const result = schema.validate(value, { abortEarly: true });
  if (result.error) throw fail(result.error.details[0].message);
  return result.value;
}
export const text = Joi.string().trim().max(10000);
export const priority = Joi.string().valid("Low", "Medium", "High", "Critical");
export const filters = Joi.object({
  status: Joi.string().max(60),
  priority,
  channel: Joi.string().valid("web", "chat", "email", "whatsapp"),
  assignedTo: oid,
  group: Joi.string().max(80),
  search: Joi.string().max(100),
  mine: Joi.boolean(),
});
const condition = Joi.object({
  field: Joi.string()
    .valid(
      "priority",
      "channel",
      "status",
      "group",
      "subject",
      "tags",
      "slaBreached",
    )
    .required(),
  operator: Joi.string().valid("eq", "contains", "in").required(),
  value: Joi.alternatives()
    .try(
      Joi.string().max(500),
      Joi.boolean(),
      Joi.array().max(20).items(Joi.string().max(80)),
    )
    .required(),
});
export const actions = Joi.object({
  priority,
  status: Joi.string().max(60),
  group: Joi.string().max(80),
  assignedTo: oid.allow(null),
  tags: Joi.array().max(20).items(Joi.string().max(60)),
  reply: text.max(5000),
}).min(1);
export const resourceSchemas = {
  sla: Joi.object({
    conditions: Joi.array().max(10).items(condition).default([]),
    policy: Joi.object({
      firstResponse: Joi.number().integer().min(1).max(43200).required(),
      nextResponse: Joi.number().integer().min(1).max(43200).required(),
      resolution: Joi.number().integer().min(1).max(43200).required(),
      businessHours: Joi.boolean().required(),
    }).required(),
  }),
  canned: Joi.object({ text: text.min(1).required() }),
  macro: Joi.object({ actions: actions.required() }),
  view: filters,
  automation: Joi.object({
    event: Joi.string()
      .valid(
        "ticket.created",
        "ticket.updated",
        "customer.replied",
        "sla.breached",
      )
      .required(),
    conditions: Joi.array().max(10).items(condition).default([]),
    actions: actions.required(),
  }),
};
const time = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsSchema = Joi.object({
  timezone: Joi.string()
    .max(80)
    .custom((value, helpers) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return value;
      } catch {
        return helpers.error("any.invalid");
      }
    }),
  language: Joi.string().valid(
    "en",
    "hi",
    "bn",
    "ta",
    "te",
    "mr",
    "gu",
    "kn",
    "ml",
    "pa",
    "hinglish",
  ),
  publicPortal: Joi.boolean(),
  businessHours: Joi.object({
    days: Joi.array()
      .min(1)
      .max(7)
      .unique()
      .items(Joi.number().integer().min(0).max(6))
      .required(),
    start: time.required(),
    end: time.required(),
    holidays: Joi.array()
      .max(100)
      .items(Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/))
      .default([]),
  }).custom((value, helpers) =>
    value.start < value.end ? value : helpers.error("any.invalid"),
  ),
  statuses: Joi.array()
    .min(4)
    .max(20)
    .unique()
    .items(Joi.string().trim().min(1).max(60))
    .has("Open")
    .has("Resolved")
    .has("Closed"),
  pauseStatuses: Joi.array().max(10).items(Joi.string().max(60)),
  sla: Joi.object({
    firstResponse: Joi.number().integer().min(1).max(43200).required(),
    nextResponse: Joi.number().integer().min(1).max(43200).required(),
    resolution: Joi.number().integer().min(1).max(43200).required(),
    businessHours: Joi.boolean().required(),
  }),
  customFields: Joi.array()
    .max(20)
    .unique("key")
    .items(
      Joi.object({
        key: Joi.string()
          .pattern(/^[a-z][a-z0-9_]{0,39}$/)
          .required(),
        label: Joi.string().max(80).required(),
        type: Joi.string()
          .valid("text", "number", "dropdown", "checkbox")
          .required(),
        required: Joi.boolean().default(false),
        options: Joi.array().max(30).items(Joi.string().max(80)),
      }),
    ),
}).min(1);
export function validateFields(definitions = [], values = {}) {
  const fields = Object.fromEntries(
    definitions.map((field) => {
      let schema =
        field.type === "number"
          ? Joi.number()
          : field.type === "checkbox"
            ? Joi.boolean().strict()
            : Joi.string().max(1000);
      if (field.type === "dropdown")
        schema = schema.valid(...(field.options || []));
      return [field.key, field.required ? schema.required() : schema];
    }),
  );
  return validate(Joi.object(fields), values);
}
