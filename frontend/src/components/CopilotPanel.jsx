import { useEffect, useId, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import {
  AlertTriangle,
  ExternalLink,
  Gavel,
  Github,
  Info,
  ListTodo,
  Loader2,
  MessageCircle,
  MessageSquare,
  Send,
  Sparkles,
} from 'lucide-react';
import { copilotApi } from '../api';
import { SOURCE_KINDS, contextNote, sourceDate, sourceHref, splitCitations } from '../copilotAnswer'; // [Sprint 6 · M4]

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
 *
 * [Sprint 6 · M4] US-42, US-43 (FR-16b, FR-16c, FR-36, NFR-10b):
 *   - Answers are built from the project's records and cite them: [T1] in the text becomes a small numbered
 *     link, and a numbered Sources list under the answer links to each task, message, comment, decision
 *     (opens it on the project page) or GitHub commit / issue / pull request (opens github.com in a new tab).
 *   - "Not enough project data" answers (insufficient: true) get their own box and no sources.
 *   - One line says how many of the project's records the answer is based on, and whether some were left
 *     out to stay within the 8,000-token AI input limit.
 *   Helpers: frontend/src/copilotAnswer.js
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
            // [Sprint 6 · M4] US-42 / US-43
            insufficient: Boolean(result?.insufficient),
            sources: Array.isArray(result?.sources) ? result.sources : [],
            context: result?.context || null,
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
            {/* [Sprint 6 · M4] US-43: not enough project data */}
            {item.insufficient ? (
              <div className="copilot-insufficient">
                <Info size={14} />
                <div>
                  <b>Not enough project data</b>
                  <p>{item.answer}</p>
                </div>
              </div>
            ) : (
              <div className="ai-summary copilot-reply">
                <span>
                  <Sparkles size={14} />
                </span>
                <p>
                  <AnswerText text={item.answer} sources={item.sources} />
                </p>
              </div>
            )}
            {/* [Sprint 6 · M4] US-42: the records the answer is built from */}
            {!item.insufficient && item.sources.length > 0 && <CopilotSources sources={item.sources} />}
            {contextNote(item.context, item.insufficient) && (
              <small className="copilot-context">{contextNote(item.context, item.insufficient)}</small>
            )}
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

// --- [Sprint 6 · M4] US-42 sources ----------------------------------------------------------------------

const SOURCE_ICONS = { task: ListTodo, decision: Gavel, message: MessageSquare, comment: MessageCircle, github: Github };

// In-app links stay in the app (react-router); GitHub opens in a new tab. A link that is not one DevOrbit
// makes is shown as plain text.
function SourceLink({ source, className, label, children }) {
  const inRouter = useInRouterContext();
  const target = sourceHref(source);
  if (!target) return <span className={className}>{children}</span>;
  if (target.external) {
    return (
      <a className={className} href={target.href} target="_blank" rel="noopener noreferrer" aria-label={label}>
        {children}
      </a>
    );
  }
  if (inRouter) {
    return (
      <Link className={className} to={target.href} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <a className={className} href={target.href} aria-label={label}>
      {children}
    </a>
  );
}

const sourceTitle = (number, source) => `Source ${number}: ${SOURCE_KINDS[source?.type] || 'Record'} ${source?.label || ''}`.trim();

// The answer as plain text, with each [T1] citation shown as a numbered link to its source.
function AnswerText({ text, sources }) {
  return splitCitations(text, sources).map((part, index) =>
    part.text !== undefined ? (
      part.text
    ) : (
      <sup className="copilot-cite" key={`cite-${index}`}>
        {part.refs.map((item) => (
          <SourceLink key={item.ref} source={item.source} className="copilot-cite-link" label={sourceTitle(item.number, item.source)}>
            {item.number}
          </SourceLink>
        ))}
      </sup>
    )
  );
}

function CopilotSources({ sources }) {
  return (
    <div className="copilot-sources">
      <small>SOURCES</small>
      <ol aria-label="Sources">
        {sources.map((source, index) => {
          const Icon = SOURCE_ICONS[source.type] || Info;
          const when = sourceDate(source);
          return (
            <li key={source.ref || index}>
              <span className="copilot-source-num" aria-hidden="true">
                {index + 1}
              </span>
              <Icon size={13} className="copilot-source-icon" aria-hidden="true" />
              <div className="copilot-source-copy">
                <SourceLink source={source} className="copilot-source-link" label={sourceTitle(index + 1, source)}>
                  {source.label || SOURCE_KINDS[source.type] || 'Record'}
                  {source.external && <ExternalLink size={10} aria-hidden="true" />}
                </SourceLink>
                <small>{[SOURCE_KINDS[source.type], source.detail, when].filter(Boolean).join(' · ')}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
