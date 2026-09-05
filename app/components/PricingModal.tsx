"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { X, Check, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, devError, extractErrorMessage, networkErrorMessage } from '../lib/config';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credits: number, tier: string) => void;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_SDK = 'https://checkout.razorpay.com/v1/checkout.js';

const PLAN_PRICE_LABEL: Record<'monthly' | 'yearly', string> = {
  monthly: '299',
  yearly: '3,399',
};

// Must stay in step with PLAN_CREDIT_GRANT in backend/app.py.
const PLAN_CREDIT_LABEL: Record<'monthly' | 'yearly', string> = {
  monthly: '10,000',
  yearly: '120,000',
};

function featuresFor(cycle: 'monthly' | 'yearly'): string[] {
  return [
    `${PLAN_CREDIT_LABEL[cycle]} premium AI credits`,
    'AI analysis on every finding, with no free-tier cap',
    'Higher scan rate limits',
    'Priority support',
  ];
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    backgroundColor: 'rgba(28, 25, 23, 0.4)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    fontFamily: 'Jost, sans-serif',
    animation: 'tuffFadeIn 300ms ease-out forwards',
  },
  modalContainer: {
    position: 'relative' as const,
    width: '100%',
    maxWidth: '800px',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    background: 'linear-gradient(135deg, #fdfbf9, #f5f1ed)',
    border: '1px solid rgba(139, 115, 85, 0.2)',
  },
  closeBtn: {
    position: 'absolute' as const,
    top: '20px',
    right: '20px',
    padding: '8px',
    borderRadius: '50%',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    color: '#8b7355',
    transition: 'transform 200ms',
  },
  content: {
    padding: '40px 32px 32px 32px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  title: {
    fontSize: '30px',
    fontWeight: 'bold',
    marginBottom: '8px',
    textAlign: 'center' as const,
    color: '#6b5344',
    fontFamily: 'Cormorant Garamond, serif',
  },
  subtitle: {
    fontSize: '14px',
    textAlign: 'center' as const,
    marginBottom: '32px',
    color: '#8b7355',
  },
  toggleContainer: {
    display: 'flex',
    backgroundColor: 'rgba(231, 229, 228, 0.5)',
    padding: '4px',
    borderRadius: '9999px',
    marginBottom: '32px',
    width: '100%',
    maxWidth: '320px',
    border: '1px solid rgba(231, 229, 228, 0.5)',
  },
  toggleBtn: {
    flex: 1,
    padding: '8px 0',
    fontSize: '14px',
    fontWeight: 600,
    borderRadius: '9999px',
    transition: 'all 300ms',
    border: 'none',
    cursor: 'pointer',
  },
  priceContainer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '4px',
    marginBottom: '32px',
  },
  priceAmount: {
    fontSize: '48px',
    fontWeight: 600,
    letterSpacing: '-0.025em',
    color: '#6b5344',
    lineHeight: 1,
  },
  pricePeriod: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#8b7355',
    paddingBottom: '6px',
  },
  featuresList: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    marginBottom: '32px',
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  featureText: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b5344',
  },
  upgradeBtn: {
    width: '100%',
    padding: '16px',
    color: 'white',
    fontSize: '14px',
    fontWeight: 600,
    borderRadius: '16px',
    border: 'none',
    transition: 'all 300ms',
    background: 'linear-gradient(135deg, rgba(139, 115, 85, 0.95), rgba(110, 90, 65, 0.95))',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  errorBox: {
    width: '100%',
    marginBottom: '16px',
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(212, 58, 42, 0.08)',
    border: '1px solid rgba(212, 58, 42, 0.3)',
    color: '#a12c23',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  footerText: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    marginTop: '20px',
    fontSize: '11px',
    fontWeight: 500,
    color: '#8b7355',
    opacity: 0.8,
  },
};

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function PricingModal({ isOpen, onClose, onSuccess }: PricingModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const handleClose = useCallback(() => {
    if (loading) return;
    setError(null);
    onClose();
  }, [loading, onClose]);

  // Escape closes the modal, and background scrolling is locked while it is
  // open -- both were missing, so the dialog felt like a dead end.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

  const handleUpgrade = async () => {
    if (!user) {
      setError('Please sign in again before upgrading.');
      return;
    }
    if (!razorpayKey) {
      setError('Checkout is not configured for this deployment. Please contact support.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sdkLoaded = await loadScript(RAZORPAY_SDK);
      if (!sdkLoaded) {
        setError('Could not load the payment provider. Check your connection or any ad blockers.');
        return;
      }

      const token = await user.getIdToken();
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const orderRes = await fetch(api.endpoints.buyCredits, {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan: billingCycle }),
      });

      if (!orderRes.ok) {
        setError(await extractErrorMessage(orderRes, 'Could not start checkout. Please try again.'));
        return;
      }
      const orderData = await orderRes.json();

      const paymentObject = new window.Razorpay({
        key: razorpayKey,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'Tuff',
        description: `Tuff Pro (${billingCycle})`,
        order_id: orderData.order_id,
        prefill: { email: user.email || '' },
        theme: { color: '#8b7355' },
        modal: {
          // Without this the button stayed in "Processing…" forever when the
          // user closed the Razorpay overlay instead of paying.
          ondismiss: () => setLoading(false),
        },
        handler: async (response: Record<string, string>) => {
          try {
            const verifyRes = await fetch(api.endpoints.verifyPayment, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              setError(
                await extractErrorMessage(
                  verifyRes,
                  'We could not confirm your payment. If you were charged, contact support and we will sort it out.',
                ),
              );
              return;
            }

            const verifyData = await verifyRes.json();
            onSuccess(verifyData.credits, verifyData.tier);
            onClose();
          } catch (e) {
            devError('Payment verification failed', e);
            setError('Payment went through but confirmation failed. Please contact support.');
          } finally {
            setLoading(false);
          }
        },
      });
      paymentObject.open();
    } catch (e) {
      devError('Payment initialisation failed', e);
      setError(networkErrorMessage());
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={handleClose} role="presentation">
      <div
        style={styles.modalContainer}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-title"
      >
        <button
          onClick={handleClose}
          style={styles.closeBtn}
          aria-label="Close upgrade dialog"
          onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <X size={20} />
        </button>

        <div style={styles.content}>
          <h2 id="pricing-title" style={styles.title}>Tuff Pro</h2>
          <p style={styles.subtitle}>
            Unlimited AI analysis on every finding Tuff surfaces.
          </p>

          <div style={styles.toggleContainer} role="group" aria-label="Billing cycle">
            {(['monthly', 'yearly'] as const).map((cycle) => (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle)}
                aria-pressed={billingCycle === cycle}
                style={{
                  ...styles.toggleBtn,
                  backgroundColor: billingCycle === cycle ? '#fff' : 'transparent',
                  color: billingCycle === cycle ? '#6b5344' : '#8b7355',
                  boxShadow: billingCycle === cycle ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  textTransform: 'capitalize',
                }}
              >
                {cycle}
                {cycle === 'yearly' && (
                  <span
                    style={{
                      marginLeft: '4px',
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      fontWeight: 'bold',
                      color: '#059669',
                      backgroundColor: '#d1fae5',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Save 5%
                  </span>
                )}
              </button>
            ))}
          </div>

          <div style={styles.priceContainer}>
            <span style={styles.priceAmount}>₹{PLAN_PRICE_LABEL[billingCycle]}</span>
            <span style={styles.pricePeriod}>/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
          </div>

          <div style={styles.featuresList}>
            {featuresFor(billingCycle).map((feature) => (
              <div key={feature} style={styles.featureItem}>
                <Check size={20} color="#8b7355" strokeWidth={2.5} />
                <span style={styles.featureText}>{feature}</span>
              </div>
            ))}
          </div>

          {error && (
            <div style={styles.errorBox} role="alert">
              {error}
            </div>
          )}

          <button
            onClick={handleUpgrade}
            disabled={loading}
            style={{
              ...styles.upgradeBtn,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.75 : 1,
            }}
          >
            {loading ? 'Processing…' : 'Upgrade Now'}
          </button>

          <div style={styles.footerText}>
            <ShieldCheck size={14} />
            <span>Payments handled by Razorpay. Tuff never sees your card details.</span>
          </div>
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes tuffFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `,
        }}
      />
    </div>
  );
}
