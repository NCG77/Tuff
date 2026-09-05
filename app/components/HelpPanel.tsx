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
            <p>Tuff needs AWS credentials to read your resource configuration and CloudWatch metrics. Use a dedicated IAM user, never your root account.</p>
            <ol style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <li><strong>Create an IAM user:</strong> In the AWS Console, go to IAM and create a user named <code>tuff-agent</code>.</li>
              <li><strong>Attach a policy:</strong> Click <em>Download IAM Policy</em> on the Connect AWS Account panel and attach it to the user. It contains two parts — a read-only block used for scanning, and a remediation block used only when you approve an action. If you want Tuff to be strictly read-only, delete every statement except <code>TUFFReadOnlyAccess</code> before attaching it; the scan will work and approvals will fail with an access-denied error.</li>
              <li><strong>Generate keys:</strong> Create an access key for this user (choose &quot;Application running outside AWS&quot;).</li>
              <li><strong>Connect:</strong> Click &quot;Connect AWS Account&quot; in the sidebar, paste the keys, and pick a region.</li>
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
                <strong>How your keys are handled:</strong> they are encrypted and kept only in this
                browser tab, then discarded when you sign out or close the tab. They are sent to the
                Tuff API to run each scan or approved action and are never written to our database.
                Rotate them in AWS if you ever suspect exposure.
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
            <p>Tuff can prune findings automatically when you delete a resource directly in the AWS console. This is optional and needs a little setup:</p>
            <ol style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <li><strong>IAM permissions:</strong> The downloadable policy already includes the EventBridge and SNS permissions needed to create the rule.</li>
              <li><strong>Create an EventBridge rule:</strong> In Amazon EventBridge, create a rule matching <em>AWS API Call via CloudTrail</em> for deletion events such as <code>TerminateInstances</code>, <code>DeleteVolume</code>, <code>DeleteDBInstance</code>, <code>DeleteBucket</code> and <code>DeleteVpc</code>.</li>
              <li><strong>Point it at Tuff:</strong> Use an API Destination (or an SNS topic with an HTTPS subscription) targeting <code>/api/webhooks/aws?user_id=&lt;your Tuff user id&gt;</code>.</li>
              <li><strong>Add the shared secret:</strong> The endpoint only accepts deliveries carrying the <code>X-Tuff-Webhook-Secret</code> header, which your operator configures as <code>AWS_WEBHOOK_SECRET</code>. Add it as a static header on the API Destination connection. Without it the webhook is rejected, because anything that can post here can modify your scan history.</li>
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
                Discover unused resources and over-provisioned instances. Tuff estimates the
                potential monthly saving for each one and can apply the fix once you approve it.
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
              Free accounts start with 1,000 AI credits. Each finding Tuff analyses costs roughly
              100 credits, so a free account covers about 10 findings. Once the credits run out,
              scanning still works and findings are still listed — they just arrive without the AI
              explanation until you upgrade.
            </p>
            <p style={{ marginTop: '12px' }}>
              <strong>Tuff Pro</strong> is ₹299/month or ₹3,399/year and includes:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li><strong>10,000 AI credits</strong> added to your balance.</li>
              <li><strong>No free-tier cap:</strong> every finding in a scan gets analysed.</li>
              <li><strong>Higher rate limits</strong> for scans and remediation.</li>
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
