import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Send, Sparkles } from 'lucide-react';
import { copilotApi } from '../api';

/*
 * [Sprint 6 · M3] US-41 Ask the Copilot (FR-16a, NFR-9, NFR-10a). Shown on the project page to members.
 *
 *   - Free-text question, up to 500 characters (counter below the box; the server checks it again).
 *   - Enter or the Ask button sends it; Shift+Enter adds a new line.
 *   - AC2: if the answer takes longer than 2 seconds, a loading indicator shows until the answer or an
 *     error arrives. Quicker answers never flash a spinner.
 *   - AI provider down (503 AI_UNAVAILABLE): "AI temporarily unavailable" here only; the rest of the
 *     project page (tasks, chat, feeds) does not depend on this panel. The question stays in the box so
 *     the member can try again.
 *   - The last few answers of this visit are listed, newest first. Nothing is saved.
 *   - Answers are plain text (React escapes them), never HTML.
 *
 * API: copilotApi.ask (frontend/src/api.js) -> POST /api/projects/:id/copilot/ask
 */
export const QUESTION_MAX_CHARS = 500;
export const LOADING_DELAY_MS = 2000;
export const MAX_SHOWN_ANSWERS = 5;
export const AI_UNAVAILABLE_TEXT = 'AI temporarily unavailable. Chat, tasks and feeds still work. Please try again in a minute.';

export function describeCopilotError(error) {
  if (error?.status === 503 || error?.response?.data?.code === 'AI_UNAVAILABLE') {
    return { unavailable: true, text: AI_UNAVAILABLE_TEXT };
  }
  if (!error?.status) return { unavailable: false, text: 'Could not reach DevOrbit. Check your connection and try again.' };
  return { unavailable: false, text: error.message || 'The Copilot could not answer. Please try again.' };
}

export default function CopilotPanel({ projectId }) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useState([]);
  // Each request gets a number; an answer that arrives after the project changed (or the panel closed) is ignored.
  const requestRef = useRef(0);
  const inputId = useId();
  const countId = useId();

  useEffect(() => {
    setQuestion('');
    setPending(false);
    setError(null);
    setAnswers([]);
    return () => {
      requestRef.current += 1;
    };
  }, [projectId]);

  // AC2: the loading indicator appears only after LOADING_DELAY_MS.
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const trimmed = question.trim();
  const tooLong = trimmed.length > QUESTION_MAX_CHARS;
  const canAsk = Boolean(trimmed) && !tooLong && !pending;

  async function submit(event) {
    event?.preventDefault();
    if (!canAsk) return;
    requestRef.current += 1;
    const request = requestRef.current;
    setPending(true);
    setError(null);
    try {
      const result = await copilotApi.ask(projectId, trimmed);
      if (request !== requestRef.current) return;
      setAnswers((list) =>
        [
          {
            key: `${request}-${result?.answeredAt || ''}`,
            question: result?.question || trimmed,
            answer: result?.answer || '',
            shortened: Boolean(result?.shortened),
          },
          ...list,
        ].slice(0, MAX_SHOWN_ANSWERS)
      );
      setQuestion('');
    } catch (err) {
      if (request !== requestRef.current) return;
      setError(describeCopilotError(err));
    } finally {
      if (request === requestRef.current) setPending(false);
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className="panel copilot-panel copilot-ask" aria-label="Ask the Copilot">
      <div className="panel-head">
        <div>
          <div className="eyebrow">AI PROJECT COPILOT</div>
          <h2 className="with-icon" style={{ marginTop: 6 }}>
            <Sparkles size={17} /> Ask the Copilot
          </h2>
        </div>
      </div>

      <form className="copilot-form" onSubmit={submit}>
        <label htmlFor={inputId} className="copilot-label">
          Your question
        </label>
        <textarea
          id={inputId}
          className="field-input copilot-input"
          rows={3}
          maxLength={QUESTION_MAX_CHARS}
          placeholder="Ask anything about this project…"
          value={question}
          readOnly={pending}
          aria-describedby={countId}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="copilot-form-foot">
          <small id={countId} className={`copilot-count${question.length >= QUESTION_MAX_CHARS - 50 ? ' near' : ''}`}>
            {question.length} / {QUESTION_MAX_CHARS}
          </small>
          <button type="submit" className="btn small" disabled={!canAsk}>
            <Send size={13} /> {pending ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>

      {pending && slow && (
        <div className="copilot-loading" role="status" aria-live="polite">
          <Loader2 size={15} className="spin" /> The Copilot is thinking…
        </div>
      )}

      {error &&
        (error.unavailable ? (
          <div className="copilot-unavailable" role="alert">
            <AlertTriangle size={15} />
            <span>{error.text}</span>
          </div>
        ) : (
          <p className="form-error copilot-error" role="alert">
            {error.text}
          </p>
        ))}

      {answers.length === 0 && !pending && !error && (
        <p className="copilot-hint">Questions can be up to {QUESTION_MAX_CHARS} characters. Answers usually arrive within 10 seconds.</p>
      )}

      <div className="copilot-answers" aria-live="polite">
        {answers.map((item) => (
          <article className="copilot-answer" key={item.key}>
            <p className="copilot-asked">
              <small>YOU ASKED</small>
              {item.question}
            </p>
            <div className="ai-summary copilot-reply">
              <span>
                <Sparkles size={14} />
              </span>
              <p>{item.answer}</p>
            </div>
            {item.shortened && <small className="copilot-shortened">This answer was shortened.</small>}
          </article>
        ))}
      </div>

      <p className="disclaimer">
        The Copilot only answers questions; it never changes your project. AI answers can be wrong, so check anything important.
      </p>
    </section>
  );
}
