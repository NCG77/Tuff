'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import './index.css';

export default function LandingPage() {
  const grainCanvasRef = useRef<HTMLCanvasElement>(null);
  const savingsCountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [approved, setApproved] = useState(new Set<string>());
  const [dismissed, setDismissed] = useState(new Set<string>());
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const canvas = grainCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    let frame = 0;

    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);

    const drawGrain = () => {
      const imageData = ctx.createImageData(w, h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 18 + (Math.random() * 18);
      }
      ctx.putImageData(imageData, 0, 0);
      frame++;
      if (frame % 3 === 0) requestAnimationFrame(drawGrain);
      else setTimeout(() => requestAnimationFrame(drawGrain), 50);
    };
    drawGrain();
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (!savingsCountRef.current) return;
    const el = savingsCountRef.current;
    const target = 4827341;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        obs.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / 2200, 1);
          const ease = 1 - Math.pow(1 - p, 4);
          el.textContent = '$' + Math.floor(ease * target).toLocaleString();
          if (p < 1) requestAnimationFrame(tick);
        };
        tick(start);
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    const lines = [
      { t: 'dim', s: '# Tuff · Cognitive Engine' },
      { t: '', s: '' },
      { t: 'dim', s: '> Analyzing 247 EC2 instances across 4 regions...' },
      { t: '', s: '' },
      { t: 'green', s: '[AGENT] Querying CloudWatch — 14d CPU window' },
      { t: 'green', s: '[RAG]   c5.2xlarge pricing  →  $0.340 / hr' },
      { t: 'green', s: '[RAG]   t3.large pricing    →  $0.083 / hr' },
      { t: '', s: '' },
      { t: 'sand', s: '[FINDING] i-0a1b2c3d4e' },
      { t: 'muted', s: '  Instance : c5.2xlarge  ·  us-east-1' },
      { t: 'muted', s: '  Avg CPU  : 3.2%  over 14 days' },
      { t: 'sand', s: '  Status   : OVER-PROVISIONED  ⚠' },
      { t: '', s: '' },
      { t: 'green', s: '[RECOMMENDATION]' },
      { t: 'muted', s: '  Downsize    →  t3.large' },
      { t: 'green', s: '  Savings     →  $174.24 / mo' },
      { t: 'muted', s: '  Confidence  →  97.3%' },
      { t: '', s: '' },
      { t: 'green', s: '[ACTION GENERATED]' },
      { t: 'muted', s: '  aws ec2 modify-instance-attribute \\' },
      { t: 'muted', s: '    --instance-id i-0a1b2c3d4e \\' },
      { t: 'muted', s: '    --instance-type {"Value":"t3.large"}' },
      { t: '', s: '' },
      { t: 'sand', s: '[STATUS] Awaiting your approval →' },
    ];

    const colorMap: { [key: string]: string } = {
      dim: 't-dim',
      sand: 't-sand',
      green: 't-green',
      muted: 't-muted',
      '': '',
    };
    const term = terminalRef.current;
    let li = 0,
      ci = 0;
    const done: any[] = [];

    const type = () => {
      if (li >= lines.length) return;
      const { t, s } = lines[li];
      const cls = colorMap[t] || '';
      if (ci <= s.length) {
        const partial = s.slice(0, ci);
        const rows = done
          .map(({ t, s }: any) => {
            const c = colorMap[t] || '';
            return c ? `<span class="${c}">${s}</span>` : s;
          })
          .join('\n');
        const cur = cls ? `<span class="${cls}">${partial}</span>` : partial;
        term.innerHTML =
          rows + (rows && '\n') + cur + (ci === s.length ? '' : '<span class="t-cursor"></span>');
        ci++;
        term.scrollTop = term.scrollHeight;
        setTimeout(type, ci === 1 ? 55 : 13);
      } else {
        done.push({ t, s });
        li++;
        ci = 0;
        setTimeout(type, li < lines.length ? 70 : 0);
      }
    };
    setTimeout(type, 1000);
  }, []);

  useEffect(() => {
    const data = [
      {
        id: 'i-0a1b2c3d4e',
        type: 'Over-provisioned EC2',
        inst: 'c5.2xlarge',
        cpu: '3.2%',
        cur: '$248/mo',
        save: '$174/mo',
        region: 'us-east-1',
        cpuWarn: false,
      },
      {
        id: 'i-5f6a7b8c9d',
        type: 'Zombie EBS Volume',
        inst: 'gp3 500GB',
        cpu: '0%',
        cur: '$40/mo',
        save: '$40/mo',
        region: 'eu-west-1',
        cpuWarn: true,
      },
      {
        id: 'i-eab12cd34e',
        type: 'Idle RDS Instance',
        inst: 'db.r5.xlarge',
        cpu: '1.1%',
        cur: '$380/mo',
        save: '$285/mo',
        region: 'us-west-2',
        cpuWarn: false,
      },
      {
        id: 'i-f0g1h2i3j4',
        type: 'Over-provisioned EC2',
        inst: 'm5.4xlarge',
        cpu: '6.8%',
        cur: '$560/mo',
        save: '$420/mo',
        region: 'ap-se-1',
        cpuWarn: false,
      },
    ];
    setFindings(data);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleApprove = (id: string) => {
    setApproved((prev) => new Set(prev).add(id));
  };

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  };

  const visibleFindings = findings.filter((f) => !dismissed.has(f.id));

  return (
    <>
      <canvas ref={grainCanvasRef} id="grain-canvas"></canvas>

      <div className="outer-bg"></div>

      <div className="frame">
        <nav ref={navRef} className={`nav-bar ${isScrolled ? 'nav-scrolled' : ''}`}>
          <Link href="/src/landing_page" className="logo fade-up d1">Tuff</Link>
          <div className="nav-center fade-up d2">
            <a href="#architecture">Architecture</a>
            <a href="#demo">Demo</a>
            <a href="#queue">Queue</a>
            <a href="#cta">Access</a>
          </div>
          <div className="nav-right fade-up d2">
            <Link href="/src/login_page" className="pill">Request Access</Link>
            <div className="hamburger">
              <span></span>
              <span></span>
            </div>
          </div>
        </nav>

        <section className="hero" style={{
          backgroundImage: 'url(/main_background.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}>
          <div className="hero-headline">
            <div className="eyebrow fade-up d2">
              FinOps Intelligence &nbsp;·&nbsp; AWS Cost Optimization
            </div>
            <h1 className="fade-up d3">
              Stop<br />
              paying for<br />
              <em>idle</em> cloud.
            </h1>
            <p className="subtitle fade-up d4">
              An agentic system that surfaces waste, reasons over real pricing, and hands you the
              exact fix.
            </p>
          </div>

          <div className="hero-bottom fade-up d5">
            <div className="hero-footnote">
              Ingestion · Analysis<br />
              Action · Interface
            </div>
            <div className="hero-corner">
              Human approval<br />
              required on every action
            </div>
          </div>
        </section>

        <div className="divider"></div>

        <div className="metrics">
          <div className="metric">
            <div className="metric-num" ref={savingsCountRef}>
              $0
            </div>
            <div className="metric-label">Savings tracked</div>
          </div>
          <div className="metric">
            <div className="metric-num">1,284</div>
            <div className="metric-label">Zombie resources found</div>
          </div>
          <div className="metric">
            <div className="metric-num">99.2%</div>
            <div className="metric-label">Actions approved</div>
          </div>
        </div>

        <section className="phases-section" id="architecture">
          <div className="section-header">
            <span className="section-label">System Architecture</span>
            <div className="section-rule"></div>
          </div>
          <div className="phases-grid">
            <div className="phase">
              <div className="phase-accent"></div>
              <div className="phase-n">01</div>
              <div className="phase-title">Ingestion</div>
              <div className="phase-desc">
                Read-only boto3 pulls CloudWatch CPU telemetry and Cost Explorer spend across all
                regions over a 14-day window.
              </div>
            </div>
            <div className="phase">
              <div className="phase-accent"></div>
              <div className="phase-n">02</div>
              <div className="phase-title">Analysis</div>
              <div className="phase-desc">
                LangChain agent + ChromaDB RAG grounds every recommendation in real AWS Pricing
                API data. No hallucinated numbers.
              </div>
            </div>
            <div className="phase">
              <div className="phase-accent"></div>
              <div className="phase-n">03</div>
              <div className="phase-title">Action</div>
              <div className="phase-desc">
                Structured JSON with exact AWS CLI commands. All scripts queued — never
                auto-executed. Every action waits for you.
              </div>
            </div>
            <div className="phase">
              <div className="phase-accent"></div>
              <div className="phase-n">04</div>
              <div className="phase-title">Interface</div>
              <div className="phase-desc">
                Next.js dashboard surfaces findings with wasted spend and reasoning. FastAPI
                executes only on your approval.
              </div>
            </div>
          </div>
        </section>

        <section className="terminal-section" id="demo">
          <div className="section-header" style={{ padding: '0', marginBottom: '52px' }}>
            <span className="section-label">Live Agent Output</span>
            <div className="section-rule"></div>
          </div>
          <div className="terminal-layout">
            <div className="terminal-copy">
              <h2>
                Watch Tuff<br />
                <em>reason</em> in real-time.
              </h2>
              <p>
                The cognitive engine queries CloudWatch, grounds every number in real AWS pricing
                via RAG, and generates the exact CLI command to fix it — held for your approval.
              </p>
            </div>
            <div className="terminal-wrap">
              <div className="term-bar">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <span className="term-title">tuff-agent · main</span>
              </div>
              <div className="term-body" ref={terminalRef} id="terminal"></div>
            </div>
          </div>
        </section>

        <section className="queue-section" id="queue">
          <div className="queue-header">
            <h2>
              Agent findings awaiting<br />
              your <em>approval.</em>
            </h2>
            <span className="queue-count">
              {visibleFindings.length} pending / {findings.length} total
            </span>
          </div>

          <div className="queue-cols">
            <span className="col-label">Resource</span>
            <span className="col-label">Type</span>
            <span className="col-label">Region</span>
            <span className="col-label">Current</span>
            <span className="col-label">Savings</span>
            <span className="col-label">CPU avg</span>
            <span className="col-label">Action</span>
          </div>

          <div id="findings">
            {visibleFindings.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '48px',
                  fontSize: '12px',
                  color: 'rgba(237,224,206,0.18)',
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                }}
              >
                All findings processed
              </div>
            ) : (
              visibleFindings.map((f) => (
                <div key={f.id} className="finding" id={`row-${f.id}`}>
                  <div>
                    <div className="finding-id">{f.id}</div>
                    <div className="finding-inst">{f.inst}</div>
                  </div>
                  <div>
                    <span className="badge">{f.type}</span>
                  </div>
                  <div className="finding-region">{f.region}</div>
                  <div className="finding-cost">{f.cur}</div>
                  <div className="finding-save">↓ {f.save}</div>
                  <div
                    className="finding-cpu"
                    style={{
                      color: f.cpuWarn ? 'rgba(220,90,70,.8)' : 'rgba(237,224,206,.5)',
                    }}
                  >
                    {f.cpu}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {approved.has(f.id) ? (
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'rgba(140,185,130,.75)',
                          letterSpacing: '.1em',
                        }}
                      >
                        ✓ Queued
                      </span>
                    ) : (
                      <>
                        <button className="approve-btn" onClick={() => handleApprove(f.id)}>
                          Approve
                        </button>
                        <button className="dismiss-btn" onClick={() => handleDismiss(f.id)}>
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="cta" id="cta">
          <h2>
            Your Cloud bill is<br />
            <em>bleeding money.</em>
          </h2>
          <p>
            Connect your account in minutes. Tuff audits everything, surfaces the waste, hands you
            the commands. You click approve.
          </p>
          <div className="cta-btns">
            <Link href="/src/signup_page" className="btn-filled">Deploy Tuff →</Link>
            <a href="https://docs.example.com" target="_blank" rel="noopener noreferrer" className="btn-outline">Read the Docs</a>
          </div>
        </section>

        <footer>
          <span className="f-logo">tuff</span>
          <span className="f-stack">Python · FastAPI · Next.js · ChromaDB · Boto3</span>
          <span className="f-copy">© 2025 Tuff FinOps</span>
        </footer>
      </div>
    </>
  );
}