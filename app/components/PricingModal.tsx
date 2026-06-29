"use client";

import React, { useState } from 'react';
import { X, Check, ShieldCheck, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/config';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credits: number, tier: string) => void;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function PricingModal({ isOpen, onClose, onSuccess }: PricingModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    if (!user) return;
    setLoading(true);
    
    try {
      const res = await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      if (!res) {
        alert('Razorpay SDK failed to load. Are you online?');
        setLoading(false);
        return;
      }

      const token = await user.getIdToken();
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      };
      
      const orderRes = await fetch(`${api.baseURL}/api/user/credits/buy`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan: billingCycle })
      });
      const orderData = await orderRes.json();
      
      if (!orderRes.ok) {
        throw new Error(orderData.detail || 'Failed to create order');
      }

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'TUFF Cloud Security',
        description: `TUFF Pro ${billingCycle} subscription`,
        order_id: orderData.order_id,
        handler: async function (response: any) {
          try {
            const verifyRes = await fetch(`${api.baseURL}/api/user/verify-payment`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                amount: orderData.amount
              })
            });
            const verifyData = await verifyRes.json();
            if (verifyRes.ok && verifyData.status === 'success') {
              onSuccess(verifyData.credits, verifyData.tier);
              onClose();
            } else {
              alert('Payment verification failed. Please contact support.');
            }
          } catch (e) {
            console.error(e);
            alert('Error verifying payment.');
          }
        },
        prefill: {
          email: user.email || ''
        },
        theme: {
          color: '#8b7355'
        }
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.open();
      
    } catch (e) {
      console.error(e);
      alert('Payment initialization failed.');
    } finally {
      setLoading(false);
    }
  };

  const loadScript = (src: string) => {
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
  };

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
    transition: 'all 300ms ease-in-out',
    animation: 'fadeIn 300ms ease-out forwards',
  },
  modalContainer: {
    position: 'relative' as const,
    width: '100%',
    maxWidth: '800px',
    borderRadius: '24px',
    overflow: 'hidden',
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
  iconWrapper: {
    padding: '12px',
    borderRadius: '16px',
    marginBottom: '24px',
    background: 'rgba(139, 115, 85, 0.08)',
    border: '1px solid rgba(139, 115, 85, 0.1)',
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
    cursor: 'pointer',
    transition: 'all 300ms',
    background: 'linear-gradient(135deg, rgba(139, 115, 85, 0.95), rgba(110, 90, 65, 0.95))',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
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
  }
};

  return (
    <div style={styles.overlay}>
      <div style={styles.modalContainer}>
        <button 
          onClick={onClose} 
          style={styles.closeBtn}
          onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <X size={20} />
        </button>

        <div style={styles.content}>
          <h2 style={styles.title}>TUFF Pro</h2>
          <p style={styles.subtitle}>
            Automate security compliance with unlimited AI resolution.
          </p>

          <div style={styles.toggleContainer}>
            <button
              onClick={() => setBillingCycle('monthly')}
              style={{
                ...styles.toggleBtn,
                backgroundColor: billingCycle === 'monthly' ? '#fff' : 'transparent',
                color: billingCycle === 'monthly' ? '#6b5344' : '#8b7355',
                boxShadow: billingCycle === 'monthly' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              style={{
                ...styles.toggleBtn,
                backgroundColor: billingCycle === 'yearly' ? '#fff' : 'transparent',
                color: billingCycle === 'yearly' ? '#6b5344' : '#8b7355',
                boxShadow: billingCycle === 'yearly' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Yearly 
              <span style={{ marginLeft: '4px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: '#059669', backgroundColor: '#d1fae5', padding: '2px 6px', borderRadius: '4px' }}>
                Save 5%
              </span>
            </button>
          </div>

          <div style={styles.priceContainer}>
            <span style={styles.priceAmount}>
              ₹{billingCycle === 'monthly' ? '299' : '3,399'}
            </span>
            <span style={styles.pricePeriod}>
              /{billingCycle === 'monthly' ? 'mo' : 'yr'}
            </span>
          </div>

          <div style={styles.featuresList}>
            {[
              "10,000 Premium AI Credits",
              "Access to openrouter/auto AI logic",
              "250k tokens per session limit",
              "Priority enterprise support"
            ].map((feature, i) => (
              <div key={i} style={styles.featureItem}>
                <Check size={20} color="#8b7355" strokeWidth={2.5} />
                <span style={styles.featureText}>{feature}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleUpgrade}
            disabled={loading}
            style={styles.upgradeBtn}
            onMouseOver={(e) => !loading && (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)')}
            onMouseOut={(e) => !loading && (e.currentTarget.style.transform = 'translateY(0)', e.currentTarget.style.boxShadow = 'none')}
          >
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Processing...</span>
              </div>
            ) : (
              "Upgrade Now"
            )}
          </button>

          <div style={styles.footerText}>
            <ShieldCheck size={14} />
            <span>Secured locally by Razorpay</span>
          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}} />
    </div>
  );
}
