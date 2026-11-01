import { PublicFAQ } from "./EnterpriseViews";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../../utils/api";
import { BookOpen, MessageCircle, Send } from "lucide-react";
interface Field {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}
interface Article {
  _id: string;
  title: string;
  body: string;
  category: string;
  slug: string;
}
const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none";
export function HelpCentre() {
  const { slug } = useParams();
  const [workspace, setWorkspace] = useState<{
      name: string;
      fields: Field[];
      aiAutomation?: boolean;
    } | null>(null),
    [articles, setArticles] = useState<Article[]>([]),
    [search, setSearch] = useState(""),
    [article, setArticle] = useState<Article | null>(null),
    [tab, setTab] = useState("help"),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [subject, setSubject] = useState(""),
    [description, setDescription] = useState(""),
    [fields, setFields] = useState<Record<string, unknown>>({}),
    [access, setAccess] = useState<{
      id: string;
      number: string;
      accessToken: string;
    } | null>(null),
    [messages, setMessages] = useState<
      { _id: string; text: string; authorRole: string }[]
    >([]),
    [reply, setReply] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/help/${slug}`;
  const widget = new URLSearchParams(location.search).get("widget") === "1";
  useEffect(() => {
    const source = new URLSearchParams(location.search).get("article");
    if (source)
      api
        .get<Article>(base + "/articles/" + encodeURIComponent(source))
        .then(({ data }) => {
          setArticle(data);
          setTab("help");
        })
        .catch(() => setError("This source article is no longer published."));
  }, [base]);
  useEffect(() => {
    let active = true;
    setError("");
    api
      .get<{ name: string; fields: Field[]; aiAutomation?: boolean }>(base)
      .then(({ data }) => {
        if (active) setWorkspace(data);
      })
      .catch(() => {
        if (active) setError("This help centre is not available.");
      });
    try {
      const saved = sessionStorage.getItem("quickfix-portal:" + slug);
      if (saved) {
        setAccess(JSON.parse(saved));
        setTab("contact");
      }
    } catch {}
    return () => {
      active = false;
    };
  }, [base, slug]);
  useEffect(() => {
    let active = true;
    api
      .get<Article[]>(base + "/articles", { params: search ? { search } : {} })
      .then(({ data }) => {
        if (active) setArticles(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [base, search]);
  useEffect(() => {
    if (!access) return;
    let active = true;
    const load = async () => {
      try {
        const { data } = await api.get<{
          ticket: { status: string };
          messages: typeof messages;
        }>(`${base}/tickets/${access.id}`, {
          headers: { "X-Ticket-Token": access.accessToken },
        });
        if (active) {
          setMessages(data.messages);
          setStatus(data.ticket.status);
        }
      } catch {
        if (active) setError("Unable to load this support conversation.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base, access]);

  const verification = new URLSearchParams(location.search),
    proof = verification.get("verify"),
    verificationTicket = verification.get("ticket");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      const detail = error as { response?: { data?: { error?: string } } };
      setError(
        detail.response?.data?.error || "Unable to submit. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className={`bg-white border-b ${widget ? "p-4" : "p-8"}`}>
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold text-blue-600 tracking-widest uppercase">
            Customer support
          </p>
          <h1 className="text-2xl font-bold mt-2">
            {workspace?.name || "Help centre"}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Find answers or start a conversation with our support team.
          </p>
        </div>
      </header>
      <main className={`max-w-4xl mx-auto ${widget ? "p-3" : "p-6"}`}>
        {proof && verificationTicket && (
          <div className="bg-blue-50 rounded-xl p-4 mb-4">
            <p className="text-sm mb-3">
              Verify your email to securely open this support conversation.
            </p>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { data } = await api.post<NonNullable<typeof access>>(
                    `${base}/tickets/${verificationTicket}/verify-email`,
                    { proof },
                  );
                  setAccess(data);
                  setTab("contact");
                  sessionStorage.setItem(
                    "quickfix-portal:" + slug,
                    JSON.stringify(data),
                  );
                  history.replaceState(null, "", `/support/${slug}`);
                })
              }
            >
              Verify email and open conversation
            </button>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="bg-red-50 text-red-800 rounded-lg p-3 mb-4 text-sm"
          >
            {error}
          </p>
        )}
        {workspace && (
          <>
            <div className="flex gap-3 mb-5">
              <button
                onClick={() => setTab("help")}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm ${tab === "help" ? "bg-blue-600 text-white" : "bg-white border"}`}
              >
                <BookOpen size={16} />
                Help articles
              </button>
              <button
                onClick={() => setTab("contact")}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm ${tab === "contact" ? "bg-blue-600 text-white" : "bg-white border"}`}
              >
                <MessageCircle size={16} />
                Contact support
              </button>
            </div>
            {tab === "help" && (
              <>
                {workspace.aiAutomation && <PublicFAQ slug={slug!} />}
                <input
                  aria-label="Search help articles"
                  className={input + " mb-5"}
                  placeholder="Search for an answer…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setArticle(null);
                  }}
                />
                {article ? (
                  <article className="bg-white border rounded-xl p-6">
                    <button
                      className="text-sm text-blue-600 mb-4"
                      onClick={() => setArticle(null)}
                    >
                      ← All articles
                    </button>
                    <p className="text-xs text-slate-400">{article.category}</p>
                    <h2 className="text-xl font-semibold my-3">
                      {article.title}
                    </h2>
                    <p className="text-sm leading-7 whitespace-pre-wrap">
                      {article.body}
                    </p>
                  </article>
                ) : (
                  <div className="grid gap-3">
                    {articles.map((item) => (
                      <button
                        key={item._id}
                        onClick={() => setArticle(item)}
                        className="bg-white border rounded-xl p-5 text-left hover:border-blue-400"
                      >
                        <p className="text-xs text-slate-400">
                          {item.category}
                        </p>
                        <h2 className="font-medium mt-2">{item.title}</h2>
                      </button>
                    ))}
                    {articles.length === 0 && (
                      <p className="p-8 text-center text-sm text-slate-500">
                        No published articles match your search. Contact support
                        for help.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {tab === "contact" &&
              (access ? (
                <section className="bg-white border rounded-xl p-5">
                  <div className="flex justify-between items-center">
                    <h2 className="font-medium text-sm">{access.number}</h2>
                    <span className="text-xs bg-blue-50 px-2 py-1 rounded">
                      {status}
                    </span>
                  </div>
                  <div className="space-y-3 py-5 max-h-[400px] overflow-auto">
                    {messages.map((message) => (
                      <div
                        key={message._id}
                        className={`p-3 rounded-lg text-sm whitespace-pre-wrap ${message.authorRole === "customer" ? "bg-slate-50" : "bg-blue-50"}`}
                      >
                        <p className="text-xs text-slate-400 mb-2">
                          {message.authorRole === "customer"
                            ? "You"
                            : "Support team"}
                        </p>
                        {message.text}
                      </div>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        const { data } = await api.post(
                          `${base}/tickets/${access.id}/messages`,
                          { text: reply },
                          { headers: { "X-Ticket-Token": access.accessToken } },
                        );
                        setMessages((old) => [...old, data]);
                        setReply("");
                      });
                    }}
                    className="space-y-3"
                  >
                    <textarea
                      required
                      rows={3}
                      className={input}
                      placeholder="Write a message…"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                    />
                    <button
                      disabled={busy}
                      className="bg-blue-600 text-white rounded-lg px-4 py-2 flex gap-2 text-sm items-center"
                    >
                      <Send size={15} />
                      Send message
                    </button>
                  </form>
                  <button
                    className="text-xs text-slate-500 mt-5"
                    onClick={() => {
                      setAccess(null);
                      setMessages([]);
                      sessionStorage.removeItem("quickfix-portal:" + slug);
                    }}
                  >
                    Start another support request
                  </button>
                  <p className="text-xs text-slate-400 mt-3">
                    This browser stores your private conversation access. Do not
                    share your access token.
                  </p>
                </section>
              ) : (
                <form
                  className="bg-white border rounded-xl p-5 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const { data } = await api.post<
                        NonNullable<typeof access>
                      >(base + "/tickets", {
                        name,
                        email,
                        subject,
                        description,
                        customFields: fields,
                        channel: widget ? "chat" : "web",
                      });
                      setAccess(data);
                      sessionStorage.setItem(
                        "quickfix-portal:" + slug,
                        JSON.stringify(data),
                      );
                    });
                  }}
                >
                  <h2 className="text-lg font-semibold">How can we help?</h2>
                  <label className="block text-sm">
                    Your name
                    <input
                      required
                      className={input}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Email
                    <input
                      required
                      type="email"
                      className={input}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Subject
                    <input
                      required
                      minLength={3}
                      className={input}
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Tell us what happened
                    <textarea
                      required
                      minLength={3}
                      rows={5}
                      className={input}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                  {workspace.fields.map((field) => (
                    <label className="block text-sm" key={field.key}>
                      {field.label}
                      {field.required ? " *" : ""}
                      {field.type === "dropdown" ? (
                        <select
                          className={input}
                          required={field.required}
                          value={String(fields[field.key] || "")}
                          onChange={(event) =>
                            setFields({
                              ...fields,
                              [field.key]: event.target.value,
                            })
                          }
                        >
                          <option value="">Choose…</option>
                          {field.options?.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      ) : field.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          className="ml-2"
                          checked={fields[field.key] === true}
                          onChange={(event) =>
                            setFields({
                              ...fields,
                              [field.key]: event.target.checked,
                            })
                          }
                        />
                      ) : (
                        <input
                          className={input}
                          required={field.required}
                          type={field.type === "number" ? "number" : "text"}
                          value={String(fields[field.key] ?? "")}
                          onChange={(event) =>
                            setFields({
                              ...fields,
                              [field.key]:
                                field.type === "number"
                                  ? Number(event.target.value)
                                  : event.target.value,
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
                  <button
                    disabled={busy}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
                  >
                    {busy ? "Submitting…" : "Submit support request"}
                  </button>
                </form>
              ))}
          </>
        )}
        <p className="text-xs text-center text-slate-400 mt-8">
          Support powered by QuickFix
        </p>
      </main>
    </div>
  );
}
