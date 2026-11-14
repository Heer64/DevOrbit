import { useEffect, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, History, Loader2, RefreshCw } from 'lucide-react';
import { catchUpApi } from '../api';
import { sourceHref } from '../copilotAnswer';
import { AI_UNAVAILABLE_TEXT, LOADING_DELAY_MS, describeCopilotError } from './CopilotPanel';
import { contextLine, countsLine, formatWhen, periodLabel, splitEventCitations, summaryPoints } from '../catchUpDisplay';

/*
 * [Sprint 6 · M5] US-44 Catch Me Up (FR-17, NFR-9, NFR-10a). Shown on the project page to members, above
 * Ask the Copilot.
 *
 *   - "Catch me up" asks for a summary of what other members did in this project since the member's
 *     previous login (AC1). Only data the member can access is used (the server checks; see
 *     backend/src/routes/catchUp.js).
 *   - If it takes longer than 2 seconds, a loading indicator shows until the summary or an error arrives.
 *   - Nothing new -> "Nothing new since your last login" (AC2).
 *   - AI provider down -> "AI temporarily unavailable" here only; the rest of the page keeps working (AC3).
 *   - Each point cites the events it is based on: [E1] becomes a small numbered link, and "Based on" lists
 *     them, each opening the task, message, decision or feed entry (GitHub opens in a new tab).
 *   - Plain text only (React escapes it). Nothing is saved.
 */

function EventLink({ source, className, label, children }) {
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

const eventTitle = (number, source) => `Event ${number}: ${source?.label || ''}`.trim();

function PointText({ text, sources }) {
  return splitEventCitations(text, sources).map((part, index) =>
    part.text !== undefined ? (
      part.text
    ) : (
      <sup className="copilot-cite" key={`cite-${index}`}>
        {part.refs.map((item) => (
          <EventLink key={item.ref} source={item.source} className="copilot-cite-link" label={eventTitle(item.number, item.source)}>
            {item.number}
          </EventLink>
        ))}
      </sup>
    )
  );
}

export default function CatchMeUpPanel({ projectId }) {
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const requestRef = useRef(0);

  useEffect(() => {
    setPending(false);
    setError(null);
    setResult(null);
    return () => {
      requestRef.current += 1;
    };
  }, [projectId]);

  // The loading indicator appears only after 2 seconds, so quick answers never flash a spinner.
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  async function run() {
    if (pending) return;
    requestRef.current += 1;
    const request = requestRef.current;
    setPending(true);
    setError(null);
    try {
      const data = await catchUpApi.run(projectId);
      if (request !== requestRef.current) return;
      setResult({
        nothingNew: Boolean(data?.nothingNew),
        message: data?.message || '',
        since: data?.since,
        basis: data?.basis,
        counts: data?.counts || null,
        points: summaryPoints(data?.summary),
        sources: Array.isArray(data?.sources) ? data.sources : [],
        context: data?.context || null,
        shortened: Boolean(data?.shortened),
      });
    } catch (err) {
      if (request !== requestRef.current) return;
      const described = describeCopilotError(err);
      setError(described.unavailable ? { unavailable: true, text: AI_UNAVAILABLE_TEXT } : described);
    } finally {
      if (request === requestRef.current) setPending(false);
    }
  }

  const counts = result?.counts ? countsLine(result.counts) : '';
  const note = result ? contextLine(result.context) : '';

  return (
    <section className="panel copilot-panel catch-up-panel" aria-label="Catch Me Up">
      <div className="panel-head">
        <div>
          <div className="eyebrow">AI PROJECT COPILOT</div>
          <h2 className="with-icon" style={{ marginTop: 6 }}>
            <History size={17} /> Catch Me Up
          </h2>
          <p>A short summary of what others did here since your previous login.</p>
        </div>
        <button type="button" className="btn small" onClick={run} disabled={pending}>
          {result || error ? <RefreshCw size={13} /> : <History size={13} />}{' '}
          {pending ? 'Catching up…' : result || error ? 'Catch me up again' : 'Catch me up'}
        </button>
      </div>

      {pending && slow && (
        <div className="copilot-loading" role="status" aria-live="polite">
          <Loader2 size={15} className="spin" /> Catching you up…
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

      {result && !error && (
        <div className="catch-up-result" aria-live="polite">
          <small className="catch-up-period">{periodLabel(result)}</small>
          {result.nothingNew ? (
            <div className="catch-up-nothing" role="status">
              <CheckCircle2 size={15} />
              <span>{result.message || 'Nothing new since your last login.'}</span>
            </div>
          ) : (
            <>
              {counts && <p className="catch-up-counts">What changed: {counts}</p>}
              <ul className="catch-up-points">
                {result.points.map((point, index) => (
                  <li key={`${index}-${point.slice(0, 20)}`}>
                    <PointText text={point} sources={result.sources} />
                  </li>
                ))}
              </ul>
              {result.sources.length > 0 && (
                <div className="copilot-sources catch-up-sources">
                  <small>BASED ON</small>
                  <ol aria-label="Events used">
                    {result.sources.map((source, index) => (
                      <li key={source.ref || index}>
                        <span className="copilot-source-num" aria-hidden="true">
                          {index + 1}
                        </span>
                        <div className="copilot-source-copy">
                          <EventLink source={source} className="copilot-source-link" label={eventTitle(index + 1, source)}>
                            {source.label || 'Event'}
                            {source.external && <ExternalLink size={10} aria-hidden="true" />}
                          </EventLink>
                          <small>{[source.detail, formatWhen(source.at)].filter(Boolean).join(' · ')}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {note && <small className="copilot-context">{note}</small>}
              {result.shortened && <small className="copilot-shortened">This summary was shortened.</small>}
            </>
          )}
        </div>
      )}

      {!result && !error && !pending && (
        <p className="copilot-hint">Uses only this project&apos;s activity that you can see, and leaves out your own actions.</p>
      )}
    </section>
  );
}
