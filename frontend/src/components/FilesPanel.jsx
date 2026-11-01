import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, File, FileArchive, FileCode2, FileImage, FileText, Paperclip, RefreshCw, Upload } from 'lucide-react';
import { fileApi } from '../api';
import { canUploadFiles } from '../roles';
import { Btn } from './ui';

/*
 * [Sprint 4 · M5] The project's Files tab (US-37 Upload a project file, FR-14a, NFR-8).
 *
 * Every member sees the list (name, size, who uploaded it, when) and can download any file.
 * Owners, Admins and Contributors also get "Upload file". Files over 10 MB are stopped here
 * with the same message the API sends, and the API enforces the limit again (413).
 *
 * Props
 *   projectId   the project
 *   myRole      'Owner' | 'Admin' | 'Contributor' | 'Viewer'
 *   api         fileApi (tests pass a fake)
 *   save        (blob, name) => void  hands the downloaded file to the browser (tests pass a fake)
 *   onChange    called after a file is uploaded (the page reloads the Activity tab)
 */

export const MAX_PROJECT_FILE_MB = 10;
export const MAX_PROJECT_FILE_BYTES = MAX_PROJECT_FILE_MB * 1024 * 1024; // same as backend/src/lib/projectFiles.js
// Same text as FILE_TOO_LARGE_MESSAGE in backend/src/lib/projectFiles.js.
export const fileTooLargeMessage = (maxBytes = MAX_PROJECT_FILE_BYTES) => {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return `This file is larger than the ${mb} MB limit. Files must be ${mb} MB or smaller.`;
};

// 812 -> "812 B", 12_700 -> "12.4 KB", 10_485_760 -> "10 MB".
export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  const shown = size >= 100 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${shown} ${units[unit]}`;
}

export const formatUploadDate = (value) => (value
  ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '');

// Checks a picked file before it is sent. Returns an error message, or '' when it can be uploaded.
export function checkFileBeforeUpload(file, maxBytes = MAX_PROJECT_FILE_BYTES) {
  if (!file) return 'Choose a file to upload.';
  if (file.size === 0) return 'This file is empty. Choose a file with some content.';
  if (file.size > maxBytes) return fileTooLargeMessage(maxBytes);
  return '';
}

// Icon and colour by file type (uses the .file-icon tones in styles.css).
export function fileLook(file) {
  const type = String(file?.contentType || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('image/')) return { icon: FileImage, tone: 'green' };
  if (/zip|tar|rar|7z|gzip/.test(type) || /\.(zip|tar|gz|rar|7z)$/.test(name)) return { icon: FileArchive, tone: 'orange' };
  if (/json|javascript|xml|x-python|x-sh/.test(type) || /\.(js|jsx|ts|tsx|json|py|java|c|cpp|sh|yml|yaml)$/.test(name)) return { icon: FileCode2, tone: 'purple' };
  if (type === 'application/pdf' || type.startsWith('text/') || /\.(pdf|txt|md|docx?|pptx?|xlsx?|csv)$/.test(name)) return { icon: FileText, tone: 'blue' };
  return { icon: File, tone: 'gray' };
}

// Hands a downloaded Blob to the browser as a normal file download.
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FilesPanel({ projectId, myRole, api = fileApi, save = saveBlob, onChange }) {
  const [files, setFiles] = useState(null);
  const [maxBytes, setMaxBytes] = useState(MAX_PROJECT_FILE_BYTES);
  const [canUpload, setCanUpload] = useState(canUploadFiles(myRole));
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState('');
  const [downloading, setDownloading] = useState('');
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const result = await api.list(projectId);
      setFiles(result.files || []);
      if (result.maxBytes) setMaxBytes(result.maxBytes);
      // The API decides; the role rule is the fallback for an older API.
      setCanUpload(typeof result.canUpload === 'boolean' ? result.canUpload : canUploadFiles(myRole));
    } catch (e) {
      setFiles([]);
      setLoadError(e.message || 'Could not load the project files.');
    }
  }, [api, myRole, projectId]);

  useEffect(() => { setFiles(null); setError(''); setNotice(''); }, [projectId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const onPick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // so picking the same file again still fires onChange
    if (!file) return;
    setError(''); setNotice('');

    const problem = checkFileBeforeUpload(file, maxBytes);
    if (problem) { setError(problem); return; }

    setUploading(file.name);
    try {
      const result = await api.upload(projectId, file);
      setNotice(`Uploaded "${result?.file?.name || file.name}".`);
      await load();
      onChange?.();
    } catch (e) {
      if (e.status === 413) setError(e.response?.data?.message || fileTooLargeMessage(maxBytes));
      else setError(e.message || 'Could not upload the file. Please try again.');
    } finally {
      setUploading('');
    }
  };

  const onDownload = async (file) => {
    setError('');
    setDownloading(file._id);
    try {
      const blob = await api.download(projectId, file._id);
      save(blob, file.name);
    } catch (e) {
      setError(e.message || `Could not download "${file.name}".`);
    } finally {
      setDownloading('');
    }
  };

  if (files === null) return <div className="task-empty"><Paperclip size={20} /><p>Loading files…</p></div>;

  const limitText = `Up to ${formatFileSize(maxBytes)} per file`;

  return (
    <section aria-label="Project files">
      <div className="repo-meta" style={{ marginBottom: 12 }}>
        <div>
          <b style={{ fontSize: 11 }}>Project files</b>
          <p style={{ fontSize: 9, color: 'var(--muted)', margin: '4px 0 0' }}>
            {limitText}. Every project member can download them.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="iconbtn" onClick={load} aria-label="Refresh files" title="Refresh"><RefreshCw size={14} /></button>
          {canUpload && (
            <>
              <input
                ref={inputRef}
                type="file"
                hidden
                onChange={onPick}
                aria-label="Choose a file to upload"
                data-testid="file-input"
              />
              <Btn icon={Upload} onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)}>
                {uploading ? 'Uploading…' : 'Upload file'}
              </Btn>
            </>
          )}
        </div>
      </div>

      {uploading && <p className="success-inline" role="status">Uploading "{uploading}"…</p>}
      {notice && <p className="success-inline" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {loadError && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{loadError}</p>}
      {!canUpload && <p style={{ fontSize: 9, color: 'var(--muted)', margin: '0 0 10px' }}>Viewers can download files but cannot upload them.</p>}

      {files.length === 0 && !loadError ? (
        <div className="task-empty">
          <Paperclip size={20} />
          <p>No files yet.{canUpload ? ' Upload the first one to keep project resources with the project.' : ''}</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Files">
          {files.map((file) => {
            const { icon: Icon, tone } = fileLook(file);
            const meta = [formatFileSize(file.size), file.uploadedBy?.name || 'Former member', formatUploadDate(file.createdAt)].filter(Boolean).join(' · ');
            return (
              <li key={file._id} className="file-row">
                <span className={`file-icon ${tone}`}><Icon size={16} /></span>
                <span className="file-copy">
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</b>
                  <small>{meta}</small>
                </span>
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => onDownload(file)}
                  disabled={downloading === file._id}
                  aria-label={`Download ${file.name}`}
                >
                  <Download size={13} /> {downloading === file._id ? 'Downloading…' : 'Download'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M5] What this file does
 * The Files tab: lists the project's uploaded files, downloads them through the
 * signed-in API, and lets Owners/Admins/Contributors upload one file at a time
 * (10 MB max, checked here and again by the server).
 * ---------------------------------------------------------------------------
 */
