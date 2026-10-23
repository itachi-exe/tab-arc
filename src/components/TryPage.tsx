import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { TabMark, Wordmark } from "./ui";

interface Message {
  id: string;
  from: "user" | "tab";
  text: string;
  time: Date;
}

const DEMO_HANDLE = "demo@icloud.com";

const SUGGESTIONS = ["balance", "send Kira 5", "split 30 with Jay and Kira"];

function timestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-2 animate-fade-in">
      <TabMark size={28} />
      <div className="bubble-them flex items-center gap-1.5 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-white/70 animate-typing-dot"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.from === "user";
  return (
    <div className={`flex flex-col gap-1 animate-slide-up ${isUser ? "items-end" : "items-start"}`}>
      {isUser ? (
        <div className="bubble-me max-w-[78%] whitespace-pre-wrap break-words px-4 py-2.5 text-[15px] leading-[1.4]">{msg.text}</div>
      ) : (
        <div className="flex max-w-[86%] items-end gap-2">
          <TabMark size={28} />
          <div className="bubble-them whitespace-pre-wrap break-words px-4 py-2.5 text-[15px] leading-[1.4]">{msg.text}</div>
        </div>
      )}
      <p className={`tnum px-2 text-[11px] text-faint ${isUser ? "" : "pl-11"}`}>{timestamp(msg.time)}</p>
    </div>
  );
}

export default function TryPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "welcome",
      from: "tab",
      text: "Hey. Text me like you'd text a friend. Tap one below to start.",
      time: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text?: string) => {
    const txt = (text ?? input).trim();
    if (!txt || loading) return;
    setInput("");
    setError(null);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      from: "user",
      text: txt,
      time: new Date(),
    };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);

    try {
      const resp = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: DEMO_HANDLE, text: txt }),
      });
      const data = (await resp.json()) as { reply?: string; error?: string };
      const reply = data.reply ?? data.error ?? "No response.";
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), from: "tab", text: reply, time: new Date() },
      ]);
    } catch {
      setError("Connection error. Check your network and try again.");
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          from: "tab",
          text: "Could not reach the server. Try again.",
          time: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg text-ink">
      <div className="page-glow" aria-hidden />
      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1120px] lg:grid-cols-[1fr_520px] lg:gap-16 lg:px-8 lg:py-10">
        {/* Desktop intro column */}
        <aside className="hidden flex-col justify-center gap-6 lg:flex">
          <Wordmark />
          <h1 className="text-[56px] font-semibold leading-[1] tracking-[-0.045em] text-ink">
            Try Tab
            <br />
            <span className="serif font-normal italic tracking-[-0.02em] text-ink-2">right here.</span>
          </h1>
          <p className="max-w-[38ch] text-[17px] leading-relaxed text-muted">
            This is the same agent that answers on iMessage, running on a demo account.
          </p>
          <ul className="flex flex-col gap-2.5 text-[15px] text-ink-2">
            {["send Kira 5", "split 30 with Jay and Kira", "hold 20 for Jay until Friday", "balance"].map((c) => (
              <li key={c}>
                <button
                  onClick={() => void send(c)}
                  disabled={loading}
                  className="mono rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-white/20 hover:text-ink disabled:opacity-40"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => void navigate("/me")} className="btn mt-2 self-start">
            Open your Tab
          </button>
        </aside>

        {/* Chat */}
        <section className="flex min-h-dvh flex-col bg-bg lg:min-h-0 lg:h-[calc(100dvh-80px)] lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-white/[0.09] lg:bg-bg-1 lg:shadow-modal">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.07] bg-[rgba(8,9,11,0.78)] px-4 py-3 backdrop-blur-xl lg:static lg:bg-transparent">
            <button
              onClick={() => void navigate("/")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-white/[0.06]"
              aria-label="Back"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <TabMark size={36} />
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-ink">Tab</p>
              <p className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="live-dot" /> Demo account on Arc
              </p>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            {loading && <TypingBubble />}
            {error && <p className="py-2 text-center text-[13px] text-danger">{error}</p>}
            <div ref={bottomRef} />
          </div>

          <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-white/[0.07] bg-[rgba(8,9,11,0.85)] px-4 pb-[calc(env(safe-area-inset-bottom)+56px)] pt-3 backdrop-blur-xl lg:static lg:bg-transparent lg:pb-4">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  onClick={() => void send(sug)}
                  disabled={loading}
                  className="mono flex-shrink-0 whitespace-nowrap rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors duration-150 hover:border-white/20 hover:text-ink disabled:opacity-40"
                >
                  {sug}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                className="input min-h-[44px] flex-1 resize-none rounded-[22px] py-2.5 text-[16px] leading-[1.5]"
                style={{ maxHeight: 120 }}
                placeholder="Message Tab"
                aria-label="Message Tab"
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
              />
              <button
                onClick={() => void send()}
                disabled={!input.trim() || loading}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white transition-[transform,opacity,background] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.93] disabled:opacity-35"
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 13V3M3 8l5-5 5 5" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
