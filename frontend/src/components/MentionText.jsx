import { splitMentions } from './mentions';

/**
 * [Sprint 3 · US-18, US-20] Message or comment text with its @mentions highlighted.
 * Only the people the API stored in `mentions` are highlighted, so "@nobody" stays plain text.
 */
export default function MentionText({ body, mentions }) {
  return splitMentions(body, mentions).map((part, index) => (part.user
    ? <span key={index} className="mention" title={part.user.name}>{part.text}</span>
    : <span key={index}>{part.text}</span>));
}
