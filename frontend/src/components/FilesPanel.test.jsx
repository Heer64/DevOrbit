// [Sprint 4 · M5] US-37 Upload a project file: Files tab (upload ≤ 10 MB, list, download, clear 10 MB message).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FilesPanel, {
  MAX_PROJECT_FILE_BYTES,
  checkFileBeforeUpload,
  fileLook,
  fileTooLargeMessage,
  formatFileSize,
} from './FilesPanel';

const P = 'p'.repeat(24);

const row = (id, extra = {}) => ({
  _id: id,
  project: P,
  name: 'meeting-notes.txt',
  size: 12_700,
  contentType: 'text/plain',
  uploadedBy: { _id: 'u1', name: 'Riya Kapoor', username: 'riyak' },
  createdAt: '2026-10-20T10:00:00.000Z',
  downloadUrl: `/api/projects/${P}/files/${id}/download`,
  ...extra,
});

// A File whose reported size can be set without allocating the bytes.
function fakeFile(name, size, type = 'text/plain') {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function fakeApi({ rows = [row('f1')], canUpload = true, uploadError = null } = {}) {
  let files = [...rows];
  return {
    list: vi.fn(() => Promise.resolve({ files, canUpload, maxBytes: MAX_PROJECT_FILE_BYTES, membershipRole: canUpload ? 'Contributor' : 'Viewer' })),
    upload: vi.fn((projectId, file) => {
      if (uploadError) return Promise.reject(uploadError);
      const saved = row(`f${files.length + 1}`, { name: file.name, size: file.size, createdAt: '2026-10-22T10:00:00.000Z' });
      files = [saved, ...files];
      return Promise.resolve({ file: saved });
    }),
    download: vi.fn(() => Promise.resolve(new Blob(['hello']))),
  };
}

async function renderPanel({ role = 'Contributor', api = fakeApi(), save = vi.fn(), onChange = vi.fn() } = {}) {
  render(<FilesPanel projectId={P} myRole={role} api={api} save={save} onChange={onChange} />);
  await screen.findByLabelText('Project files');
  return { api, save, onChange };
}

const pick = (file) => fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });

describe('file helpers', () => {
  it('formats sizes', () => {
    expect(formatFileSize(812)).toBe('812 B');
    expect(formatFileSize(12_700)).toBe('12.4 KB');
    expect(formatFileSize(MAX_PROJECT_FILE_BYTES)).toBe('10 MB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('allows exactly 10 MB, refuses 10 MB + 1 byte with the 10 MB message, refuses empty files', () => {
    expect(checkFileBeforeUpload(fakeFile('ok.bin', MAX_PROJECT_FILE_BYTES))).toBe('');
    expect(checkFileBeforeUpload(fakeFile('big.bin', MAX_PROJECT_FILE_BYTES + 1))).toBe(fileTooLargeMessage());
    expect(fileTooLargeMessage()).toBe('This file is larger than the 10 MB limit. Files must be 10 MB or smaller.');
    expect(checkFileBeforeUpload(fakeFile('empty.txt', 0))).toMatch(/empty/);
    expect(checkFileBeforeUpload(null)).toBe('Choose a file to upload.');
  });

  it('picks an icon tone by type', () => {
    expect(fileLook({ name: 'a.png', contentType: 'image/png' }).tone).toBe('green');
    expect(fileLook({ name: 'a.zip', contentType: 'application/zip' }).tone).toBe('orange');
    expect(fileLook({ name: 'spec.pdf', contentType: 'application/pdf' }).tone).toBe('blue');
    expect(fileLook({ name: 'data.bin', contentType: 'application/octet-stream' }).tone).toBe('gray');
  });
});

describe('FilesPanel', () => {
  it('lists the project files with size, uploader and date', async () => {
    await renderPanel();
    const list = screen.getByRole('list', { name: 'Files' });
    expect(within(list).getByText('meeting-notes.txt')).toBeTruthy();
    expect(within(list).getByText(/12\.4 KB · Riya Kapoor · Oct 20, 2026/)).toBeTruthy();
    expect(screen.getByText(/Up to 10 MB per file/)).toBeTruthy();
  });

  it('AC1: a Contributor uploads a file of 10 MB or less and it appears in the list', async () => {
    const { api, onChange } = await renderPanel();
    pick(fakeFile('design.pdf', 2048, 'application/pdf'));
    await screen.findByText('Uploaded "design.pdf".');
    expect(api.upload).toHaveBeenCalledWith(P, expect.any(File));
    expect(within(screen.getByRole('list', { name: 'Files' })).getByText('design.pdf')).toBeTruthy();
    expect(onChange).toHaveBeenCalled();
  });

  it('AC2: a file over 10 MB is stopped with a message stating the 10 MB limit and is not sent', async () => {
    const { api } = await renderPanel();
    pick(fakeFile('huge.zip', MAX_PROJECT_FILE_BYTES + 1, 'application/zip'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/10 MB limit/);
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('AC2: shows the server message when the API rejects the file with 413', async () => {
    const error = Object.assign(new Error('This file is larger than the 10 MB limit. Files must be 10 MB or smaller.'), {
      status: 413,
      response: { status: 413, data: { message: 'This file is larger than the 10 MB limit. Files must be 10 MB or smaller.', code: 'file_too_large' } },
    });
    await renderPanel({ api: fakeApi({ uploadError: error }) });
    pick(fakeFile('sneaky.bin', 1024));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This file is larger than the 10 MB limit. Files must be 10 MB or smaller.');
  });

  it('members can download a file; the bytes are handed to the browser with the file name', async () => {
    const { api, save } = await renderPanel({ role: 'Viewer', api: fakeApi({ canUpload: false }) });
    fireEvent.click(screen.getByRole('button', { name: 'Download meeting-notes.txt' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(api.download).toHaveBeenCalledWith(P, 'f1');
    expect(save.mock.calls[0][1]).toBe('meeting-notes.txt');
  });

  it('a download failure shows an error', async () => {
    const api = fakeApi();
    api.download = vi.fn(() => Promise.reject(new Error('File not found.')));
    await renderPanel({ api });
    fireEvent.click(screen.getByRole('button', { name: 'Download meeting-notes.txt' }));
    expect((await screen.findByRole('alert')).textContent).toBe('File not found.');
  });

  it('Viewers see no upload button and a note explaining why', async () => {
    await renderPanel({ role: 'Viewer', api: fakeApi({ canUpload: false }) });
    expect(screen.queryByRole('button', { name: /Upload file/ })).toBeNull();
    expect(screen.getByText('Viewers can download files but cannot upload them.')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    await renderPanel({ api: fakeApi({ rows: [] }) });
    expect(screen.getByText(/No files yet\./)).toBeTruthy();
  });
});
