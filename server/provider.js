/** Provider contract. Real payment execution is intentionally not implemented. */
export class PaymentProvider {
  async confirm() { throw new Error('Payment provider is not configured'); }
}

export class SimulatedPaymentProvider extends PaymentProvider {
  async confirm() {
    return { status: 'success', simulated: true };
  }
}

export function getPaymentProvider() {
  if ((process.env.PAYMENT_PROVIDER || 'simulated') !== 'simulated') {
    throw new Error('Only the simulated payment provider is available in this build');
  }
  return new SimulatedPaymentProvider();
}
