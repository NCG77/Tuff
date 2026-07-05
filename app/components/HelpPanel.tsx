import React from 'react';
import { BookOpen, Key, Shield, Zap, Info, ArrowRight } from 'lucide-react';

export default function HelpPanel({ onUpgradeClick }: { onUpgradeClick: () => void }) {
  return (
    <div style={{ padding: '24px', fontFamily: 'Jost, sans-serif' }}>
      <div style={{ 
        maxWidth: '1000px', 
        margin: '0 auto', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '32px' 
      }}>
        
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <h2 style={{ 
            fontSize: '32px', 
            fontWeight: 600, 
            color: '#6b5344', 
            fontFamily: 'Cormorant Garamond, serif',
            marginBottom: '8px'
          }}>
            TUFF Support & Documentation
          </h2>
          <p style={{ color: '#8b7355', fontSize: '16px' }}>
            Everything you need to secure and optimize your cloud infrastructure.
          </p>
        </div>

        <section style={{ 
          background: 'rgba(255, 255, 255, 0.5)', 
          borderRadius: '16px', 
          padding: '32px',
          border: '1px solid rgba(139, 115, 85, 0.15)',
          boxShadow: '0 10px 30px rgba(139, 115, 85, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '10px', background: 'rgba(139, 115, 85, 0.1)', borderRadius: '12px' }}>
              <Key style={{ color: '#8b7355', width: '24px', height: '24px' }} />
            </div>
            <h3 style={{ fontSize: '22px', fontWeight: 600, color: '#6b5344' }}>Setting up the AWS Agent</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: '#8b7355' }}>
            <p>To allow TUFF to scan and evaluate your infrastructure, you need to provide read-only AWS credentials. We ensure your keys never leave your browser unencrypted.</p>
            <ol style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <li><strong>Create an IAM User:</strong> Log in to your AWS Console, navigate to IAM, and create a new user named <code>tuff-agent</code>.</li>
              <li><strong>Attach Policies:</strong> Attach the <code>ReadOnlyAccess</code> and <code>SecurityAudit</code> policies to this user. This guarantees TUFF cannot modify anything without your explicit approval. </li>
              <li><strong>Generate Keys:</strong> Create an Access Key for this user (choose "Application running outside AWS").</li>
              <li><strong>Connect:</strong> Click the "Connect AWS Account" button on the sidebar in TUFF, paste your Access Key and Secret Key, and choose your primary region.</li>
            </ol>
            <div style={{ 
              marginTop: '12px', 
              padding: '16px', 
              background: 'rgba(139, 115, 85, 0.05)', 
              borderRadius: '8px',
              borderLeft: '4px solid #8b7355',
              display: 'flex',
              gap: '12px'
            }}>
              <Info style={{ color: '#8b7355', flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: '14px' }}>
                For automatic remediation features, you will need to approve generated IAM policies on a per-action basis. TUFF handles this by providing a zero-trust policy generation workflow.
              </p>
            </div>
          </div>
        </section>

        <section style={{ 
          background: 'rgba(255, 255, 255, 0.5)', 
          borderRadius: '16px', 
          padding: '32px',
          border: '1px solid rgba(139, 115, 85, 0.15)',
          boxShadow: '0 10px 30px rgba(139, 115, 85, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '10px', background: 'rgba(139, 115, 85, 0.1)', borderRadius: '12px' }}>
              <Zap style={{ color: '#8b7355', width: '24px', height: '24px' }} />
            </div>
            <h3 style={{ fontSize: '22px', fontWeight: 600, color: '#6b5344' }}>Real-Time EventBridge Sync</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: '#8b7355' }}>
            <p>TUFF supports real-time dashboard synchronization when cloud resources are deleted via the AWS console. To enable this, set up an AWS EventBridge webhook:</p>
            <ol style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <li><strong>IAM Permissions:</strong> Ensure your TUFF IAM user has permissions to configure EventBridge. You can use our AI Policy Generator to automatically generate the necessary JSON for this!</li>
              <li><strong>Create EventBridge Rule:</strong> Navigate to Amazon EventBridge, and create a rule matching AWS API Call via CloudTrail for deletion events (e.g., <code>TerminateInstances</code>, <code>DeleteVolume</code>).</li>
              <li><strong>Set the Target:</strong> Configure an API Destination (or an SNS Topic with HTTP subscription) pointing to your hosted TUFF Webhook URL: <code>/api/webhooks/aws</code>.</li>
              <li><strong>Confirm:</strong> TUFF automatically handles SNS Subscription Confirmations. Once active, your dashboard will seamlessly update in real-time when resources are deleted directly in AWS.</li>
            </ol>
          </div>
        </section>

        <section style={{ 
          background: 'rgba(255, 255, 255, 0.5)', 
          borderRadius: '16px', 
          padding: '32px',
          border: '1px solid rgba(139, 115, 85, 0.15)',
          boxShadow: '0 10px 30px rgba(139, 115, 85, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '10px', background: 'rgba(139, 115, 85, 0.1)', borderRadius: '12px' }}>
              <BookOpen style={{ color: '#8b7355', width: '24px', height: '24px' }} />
            </div>
            <h3 style={{ fontSize: '22px', fontWeight: 600, color: '#6b5344' }}>Application Manual</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
            
            <div style={{ padding: '20px', border: '1px solid rgba(139, 115, 85, 0.1)', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.3)' }}>
              <h4 style={{ fontSize: '18px', fontWeight: 600, color: '#6b5344', marginBottom: '12px' }}>Cloud Overview</h4>
              <p style={{ color: '#8b7355', fontSize: '14px', lineHeight: '1.6' }}>
                View all your scanned resources, identified security vulnerabilities, and AI-generated remediation steps. Click on any finding to view an in-depth analysis from our AI engine.
              </p>
            </div>

            <div style={{ padding: '20px', border: '1px solid rgba(139, 115, 85, 0.1)', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.3)' }}>
              <h4 style={{ fontSize: '18px', fontWeight: 600, color: '#6b5344', marginBottom: '12px' }}>Cost Explorer</h4>
              <p style={{ color: '#8b7355', fontSize: '14px', lineHeight: '1.6' }}>
                Discover unused resources and over-provisioned instances. TUFF's AI estimates potential monthly savings and provides 1-click resize/terminate scripts.
              </p>
            </div>

            <div style={{ padding: '20px', border: '1px solid rgba(139, 115, 85, 0.1)', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.3)' }}>
              <h4 style={{ fontSize: '18px', fontWeight: 600, color: '#6b5344', marginBottom: '12px' }}>Alerts & Logs</h4>
              <p style={{ color: '#8b7355', fontSize: '14px', lineHeight: '1.6' }}>
                Set up custom billing or CPU threshold alerts. The Logs tab acts as your audit trail, keeping track of every approval or remediation action you take.
              </p>
            </div>

          </div>
        </section>

        <section style={{ 
          background: 'linear-gradient(135deg, rgba(139, 115, 85, 0.05), rgba(110, 90, 65, 0.1))', 
          borderRadius: '16px', 
          padding: '32px',
          border: '1px solid rgba(139, 115, 85, 0.25)',
          boxShadow: '0 10px 30px rgba(139, 115, 85, 0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '10px', background: 'rgba(139, 115, 85, 0.15)', borderRadius: '12px' }}>
              <Shield style={{ color: '#8b7355', width: '24px', height: '24px' }} />
            </div>
            <h3 style={{ fontSize: '22px', fontWeight: 600, color: '#6b5344' }}>TUFF Pro Upgrade Options</h3>
          </div>
          
          <div style={{ color: '#8b7355', marginBottom: '24px', lineHeight: '1.6' }}>
            <p>
              Free tier users receive 1,000 AI Credits and standard analysis via our fast models. However, large infrastructure scans and complex automated remediations require deeper reasoning capabilities. 
            </p>
            <p style={{ marginTop: '12px' }}>
              By upgrading to <strong>TUFF Pro</strong> (₹1,000 one-time), you permanently unlock:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li><strong>10,000 Premium AI Credits:</strong> Enough for thousands of deep infrastructure audits.</li>
              <li><strong>Google Gemini 2.5 Pro:</strong> Replaces the standard model with state-of-the-art reasoning for zero-trust security and exact IAM policy generation.</li>
              <li><strong>Expanded Rate Limits:</strong> Process up to 250,000 tokens per session.</li>
            </ul>
          </div>

          <button 
            onClick={onUpgradeClick}
            style={{
              background: 'linear-gradient(135deg, rgba(139, 115, 85, 0.9), rgba(110, 90, 65, 0.9))',
              color: '#fff',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '24px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(139, 115, 85, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            Upgrade to Pro <ArrowRight size={18} />
          </button>
        </section>

      </div>
    </div>
  );
}
