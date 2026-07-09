import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TokenDialog from '../../src/components/TokenDialog.svelte';
import {
  setToken,
  clearToken,
  isAuthenticated,
  getToken,
  validateToken,
} from '../../src/api/auth.js';

// Mock the auth module — the dialog is UI glue; we verify it calls the
// right auth functions rather than exercising real storage/network.
vi.mock('../../src/api/auth.js', () => ({
  setToken: vi.fn(),
  clearToken: vi.fn(),
  isAuthenticated: vi.fn(() => false),
  isTokenPersisted: vi.fn(() => false),
  getToken: vi.fn(() => null),
  validateToken: vi.fn(),
}));

const mockSetToken = vi.mocked(setToken);
const mockClearToken = vi.mocked(clearToken);
const mockIsAuthenticated = vi.mocked(isAuthenticated);
const mockGetToken = vi.mocked(getToken);
const mockValidateToken = vi.mocked(validateToken);

describe('TokenDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.mockReturnValue(false);
    mockGetToken.mockReturnValue(null);
  });

  it('renders nothing when closed', () => {
    render(TokenDialog, { props: { open: false, onClose: vi.fn(), onTokenChange: vi.fn() } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog with correct ARIA attributes when open', () => {
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('shows "Not authenticated" status when not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });
    expect(screen.getByText('Not authenticated')).toBeTruthy();
    expect(screen.getByText(/public preview imagery \(DSS\)/)).toBeTruthy();
  });

  it('shows "Authenticated" status when authenticated', () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetToken.mockReturnValue('some-token');
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });
    expect(screen.getByText('Authenticated')).toBeTruthy();
  });

  it('saving a token calls setToken and onTokenChange with the token', async () => {
    const onTokenChange = vi.fn();
    const onClose = vi.fn();
    render(TokenDialog, { props: { open: true, onClose, onTokenChange } });

    const input = screen.getByLabelText('RSP token') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'my-secret-token' } });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    await fireEvent.click(saveBtn);

    expect(mockSetToken).toHaveBeenCalledWith('my-secret-token', false);
    expect(onTokenChange).toHaveBeenCalledWith('my-secret-token');
    expect(onClose).toHaveBeenCalled();
  });

  it('trims whitespace from the token before saving', async () => {
    const onTokenChange = vi.fn();
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange } });

    const input = screen.getByLabelText('RSP token') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '  padded-token  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSetToken).toHaveBeenCalledWith('padded-token', false);
    expect(onTokenChange).toHaveBeenCalledWith('padded-token');
  });

  it('does not save an empty token', async () => {
    const onTokenChange = vi.fn();
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange } });

    // Save button is disabled with empty input, but calling handler directly
    // (via click) must be a no-op regardless.
    const saveBtn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    await fireEvent.click(saveBtn);
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(onTokenChange).not.toHaveBeenCalled();
  });

  it('clearing calls clearToken and onTokenChange(null)', async () => {
    const onTokenChange = vi.fn();
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange } });

    const clearBtn = screen.getByRole('button', { name: 'Clear / Log out' });
    await fireEvent.click(clearBtn);

    expect(mockClearToken).toHaveBeenCalled();
    expect(onTokenChange).toHaveBeenCalledWith(null);
  });

  it('uses a password input so the token is masked', () => {
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });
    const input = screen.getByLabelText('RSP token') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('Cancel button calls onClose without mutating the token', async () => {
    const onClose = vi.fn();
    const onTokenChange = vi.fn();
    render(TokenDialog, { props: { open: true, onClose, onTokenChange } });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(mockClearToken).not.toHaveBeenCalled();
  });

  it('close (×) button calls onClose', async () => {
    const onClose = vi.fn();
    render(TokenDialog, { props: { open: true, onClose, onTokenChange: vi.fn() } });
    await fireEvent.click(screen.getByLabelText('Close token dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key calls onClose', async () => {
    const onClose = vi.fn();
    render(TokenDialog, { props: { open: true, onClose, onTokenChange: vi.fn() } });
    const dialog = screen.getByRole('dialog');
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('validate shows success when validateToken resolves true', async () => {
    mockValidateToken.mockResolvedValue(true);
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });

    const input = screen.getByLabelText('RSP token') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'valid-token' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    expect(mockValidateToken).toHaveBeenCalledWith('valid-token');
    await waitFor(() => expect(screen.getByText('Token is valid.')).toBeTruthy());
  });

  it('validate shows failure when validateToken resolves false', async () => {
    mockValidateToken.mockResolvedValue(false);
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });

    const input = screen.getByLabelText('RSP token') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'bad-token' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(screen.getByText(/Token validation failed/)).toBeTruthy());
  });

  it('validate handles a thrown error gracefully', async () => {
    mockValidateToken.mockRejectedValue(new Error('boom'));
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });

    const input = screen.getByLabelText('RSP token') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'err-token' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(screen.getByText(/Token validation failed/)).toBeTruthy());
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('shows the help line for obtaining a token', () => {
    render(TokenDialog, { props: { open: true, onClose: vi.fn(), onTokenChange: vi.fn() } });
    expect(screen.getByText(/Security Tokens/)).toBeTruthy();
    expect(screen.getByText(/read:image, read:tap/)).toBeTruthy();
  });
});
