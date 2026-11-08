import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Send, X } from 'lucide-react';
import { postApi } from '../api';
import {
  MAX_POST_IMAGE_MB,
  POST_CREATED_MESSAGE,
  POST_IMAGE_ACCEPT,
  POST_TEXT_MAX,
  POSTS_PER_HOUR,
  checkPostImage,
  checkPostText,
  postErrorMessage,
  postTextLength,
} from '../posts';

/*
 * [Sprint 5 · M6] US-50 Create a public post.
 *   AC1 text up to 500 characters + optionally ONE JPEG/PNG/WebP image up to 5 MB -> "Your post is published."
 *   AC2 the 11th post in an hour shows the server's rate-limit message
 *   AC3 a post that fails validation shows why (checked here first, then again by the server)
 *
 * Props: api (postApi, swapped in tests), onCreated(post) after a successful post.
 */

function makePreviewUrl(file) {
  try {
    return file && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '';
  } catch {
    return '';
  }
}

function dropPreviewUrl(url) {
  try {
    if (url && URL.revokeObjectURL) URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function PostComposer({ api = postApi, onCreated }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef(null);

  useEffect(() => () => dropPreviewUrl(preview), [preview]);

  const length = postTextLength(text);
  const over = length > POST_TEXT_MAX;

  const clearImage = () => {
    setImage(null);
    setPreview('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const pickImage = (event) => {
    const file = event.target.files?.[0] || null;
    setNotice('');
    if (!file) return;
    const problem = checkPostImage(file);
    if (problem) {
      setError(problem);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setError('');
    setImage(file);
    setPreview(makePreviewUrl(file));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setNotice('');
    const problem = checkPostText(text) || checkPostImage(image);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result = await api.create({ text, image });
      setText('');
      clearImage();
      setNotice(result?.message || POST_CREATED_MESSAGE);
      onCreated?.(result?.post);
    } catch (failure) {
      setError(postErrorMessage(failure, 'Your post could not be published. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel post-composer" onSubmit={submit} aria-label="Create a post" noValidate>
      <div className="panel-head">
        <div>
          <h2>Share with the community</h2>
          <p>Posts are public and not tied to a project. Up to {POST_TEXT_MAX} characters and one image.</p>
        </div>
      </div>
      <textarea
        className="field-input post-text"
        rows={4}
        value={text}
        onChange={(event) => { setText(event.target.value); setNotice(''); if (error) setError(''); }}
        placeholder="What are you building, learning or looking for?"
        aria-label="Post text"
        aria-invalid={over || undefined}
        disabled={busy}
      />
      {preview && (
        <div className="post-preview">
          <img src={preview} alt="Selected image preview" />
          <button type="button" className="iconbtn" aria-label="Remove image" onClick={clearImage} disabled={busy}><X size={14} /></button>
        </div>
      )}
      {image && !preview && (
        <p className="tiny-note post-image-name">
          Image: {image.name}
          <button type="button" className="link" onClick={clearImage} disabled={busy}>Remove</button>
        </p>
      )}
      <div className="post-composer-bar">
        <input
          ref={fileInput}
          type="file"
          accept={POST_IMAGE_ACCEPT}
          onChange={pickImage}
          hidden
          data-testid="post-image-input"
          aria-label="Choose an image"
        />
        <button type="button" className="btn secondary small" onClick={() => fileInput.current?.click()} disabled={busy || Boolean(image)}>
          <ImagePlus size={14} /> {image ? 'Image added' : 'Add image'}
        </button>
        <span className="tiny-note post-hint">JPEG, PNG or WebP · up to {MAX_POST_IMAGE_MB} MB · {POSTS_PER_HOUR} posts per hour</span>
        <span className={`char-count ${over ? 'over' : ''}`} aria-live="polite">{length}/{POST_TEXT_MAX}</span>
        <button type="submit" className="btn small" disabled={busy}>
          <Send size={14} /> {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-inline" role="status">{notice}</p>}
    </form>
  );
}
