// [Sprint 6 · M6] US-55 report rules in the browser (same values as backend/src/lib/reportRules.js).
import { describe, expect, it } from 'vitest';
import {
  REPORT_ALREADY_MESSAGE,
  REPORT_DETAILS_MAX,
  REPORT_DETAILS_REQUIRED_MESSAGE,
  REPORT_DETAILS_TOO_LONG_MESSAGE,
  REPORT_FAILED_MESSAGE,
  REPORT_REASONS,
  REPORT_REASON_MESSAGE,
  checkReport,
  isAlreadyReported,
  reportDetailsLength,
  reportErrorMessage,
} from './reports';

const failure = (status, message = '') => Object.assign(new Error(message), { status });

describe('report rules', () => {
  it('has the same reasons and limit as the server', () => {
    expect(REPORT_REASONS.map((item) => item.value)).toEqual(['spam', 'harassment', 'hate', 'violence', 'explicit', 'other']);
    expect(REPORT_REASONS.map((item) => item.label)).toEqual([
      'Spam or misleading',
      'Harassment or bullying',
      'Hate speech or symbols',
      'Violence or threats',
      'Sexual or explicit content',
      'Something else',
    ]);
    expect(REPORT_DETAILS_MAX).toBe(300);
  });

  it('needs a known reason; details are optional except for "Something else"', () => {
    expect(checkReport({})).toBe(REPORT_REASON_MESSAGE);
    expect(checkReport({ reason: 'SPAM' })).toBe(REPORT_REASON_MESSAGE);
    expect(checkReport({ reason: 'spam' })).toBe('');
    expect(checkReport({ reason: 'spam', details: 'x'.repeat(300) })).toBe('');
    expect(checkReport({ reason: 'spam', details: 'x'.repeat(301) })).toBe(REPORT_DETAILS_TOO_LONG_MESSAGE);
    expect(checkReport({ reason: 'other', details: '   ' })).toBe(REPORT_DETAILS_REQUIRED_MESSAGE);
    expect(checkReport({ reason: 'other', details: 'Stolen code' })).toBe('');
  });

  it('counts details like the server (trimmed, \\r\\n is one character)', () => {
    expect(reportDetailsLength('  ab\r\ncd  ')).toBe(5);
    expect(reportDetailsLength(undefined)).toBe(0);
  });

  it('turns failures into messages; 409 means "already reported" (AC2)', () => {
    expect(isAlreadyReported(failure(409))).toBe(true);
    expect(isAlreadyReported(failure(400))).toBe(false);
    expect(reportErrorMessage(failure(409, 'anything'))).toBe(REPORT_ALREADY_MESSAGE);
    expect(reportErrorMessage(failure(404))).toBe('Post not found. It may have been deleted.');
    expect(reportErrorMessage(failure(400, 'Choose a reason for your report.'))).toBe('Choose a reason for your report.');
    expect(reportErrorMessage(failure(500, 'stack trace here'))).toBe(REPORT_FAILED_MESSAGE);
    expect(reportErrorMessage(new TypeError('Failed to fetch'))).toBe(REPORT_FAILED_MESSAGE);
    expect(reportErrorMessage(null)).toBe(REPORT_FAILED_MESSAGE);
  });
});
