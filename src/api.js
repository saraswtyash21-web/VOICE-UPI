async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Please try again.');
  return data;
}
export const api = {
  recipients: () => request('/recipients'),
  addRecipient: body => request('/recipients', { method: 'POST', body: JSON.stringify(body) }),
  createIntent: body => request('/payment-intents', { method: 'POST', body: JSON.stringify(body) }),
  confirm: id => request(`/transactions/${id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
  cancel: id => request(`/transactions/${id}/cancel`, { method: 'POST', body: '{}' }),
  transactions: () => request('/transactions'),
};
