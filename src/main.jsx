import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { translations } from './translations.js';
import './ui.css';

function Icon({ name }) {
  if (name === 'mic') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a2 2 0 0 0-2 2v7a2 2 0 0 0 4 0v-7a2 2 0 0 0-2-2Z"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3m-3 0h6"/></svg>;
  if (name === 'send') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z"/><path d="m11.5 13.5 3.5-4"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>;
}

function App() {
  const [lang, setLang] = useState('en');
  const [account, setAccount] = useState(() => JSON.parse(localStorage.getItem('voiceguide.account') || 'null'));
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('voiceguide.unlocked') === 'yes');
  const [authMode, setAuthMode] = useState('signup');
  const [authForm, setAuthForm] = useState({name:'',email:'',pin:'',confirmPin:''});
  const [authError, setAuthError] = useState('');
  const t = translations[lang];
  const speechLang = lang === 'en' ? 'en-IN' : 'hi-IN';
  const [step, setStep] = useState(1);
  const [recipients, setRecipients] = useState([]);
  const [history, setHistory] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [intent, setIntent] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: '', upiId: '', relation: '' });
  const [listening, setListening] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const filtered = useMemo(() => recipients.filter(r => `${r.name} ${r.upiId}`.toLowerCase().includes(search.toLowerCase())), [recipients, search]);

  async function pinHash(pin, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:120000,hash:'SHA-256'},material,256);
    return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function submitAuth(e) {
    e.preventDefault(); setAuthError('');
    if (authMode==='signup') {
      if (authForm.pin.length!==6 || authForm.pin!==authForm.confirmPin) { setAuthError('Enter the same 6-digit app access PIN twice.'); return; }
      const salt=crypto.randomUUID(); const hash=await pinHash(authForm.pin,salt);
      const next={name:authForm.name.trim(),email:authForm.email.trim(),salt,hash};
      localStorage.setItem('voiceguide.account',JSON.stringify(next)); setAccount(next); sessionStorage.setItem('voiceguide.unlocked','yes');setUnlocked(true);
    } else {
      if (!account || await pinHash(authForm.pin,account.salt)!==account.hash) {setAuthError('That app access PIN does not match.');return;}
      sessionStorage.setItem('voiceguide.unlocked','yes');setUnlocked(true);
    }
  }

  async function refresh() {
    const [r, h] = await Promise.all([api.recipients(), api.transactions()]);
    setRecipients(r.recipients); setHistory(h.transactions);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);

  function say(text) {
    if (!('speechSynthesis' in window)) { setAnnouncement(text); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = speechLang; speechSynthesis.speak(utterance);
  }
  function parseVoice(text) {
    setAnnouncement(text);
    const found = recipients.find(r => text.toLowerCase().includes(r.name.toLowerCase().split(' ')[0]));
    const money = text.match(/(?:₹|rs\.?\s*|rupees?\s*|रुपये\s*)?([0-9][0-9,]*)/i)?.[1]?.replaceAll(',', '');
    if (found) setRecipient(found);
    if (money) setAmount(money);
    if (found && money) say(`I heard ${found.name}, rupees ${money}. Please review the details on screen.`);
    else if (found) say(`I heard ${found.name}. How much would you like to send?`);
    else say('Please choose a saved person on screen, then tell me the amount.');
  }
  function startVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setError('Voice input is not available in this browser. You can type or select instead.'); return; }
    const recognition = new Recognition(); recognition.lang = speechLang; recognition.interimResults = false;
    recognition.onstart = () => setListening(true); recognition.onend = () => setListening(false);
    recognition.onerror = e => { setListening(false); setError(e.error === 'not-allowed' ? 'Allow microphone access, or type instead.' : 'I did not catch that. Please try again.'); };
    recognition.onresult = e => parseVoice(e.results[0][0].transcript); recognition.start();
  }
  async function addRecipient(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try { const { recipient: added } = await api.addRecipient(draft); setRecipients([...recipients, added]); setRecipient(added); setDraft({ name: '', upiId: '', relation: '' }); setShowAdd(false); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function reviewPayment() {
    setError(''); setBusy(true);
    try {
      const { transaction } = await api.createIntent({ recipientId: recipient.id, upiId: recipient.upiId, amountRupees: Number(amount), note });
      setIntent(transaction); setStep(3); say(`Please review ${recipient.name}, rupees ${amount}. No payment will happen until you press confirm.`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function confirmPayment() {
    if (!window.confirm(`Confirm simulated payment of ₹${Number(amount).toLocaleString('en-IN')} to ${recipient.name}?\n\nThis is a demo. No real money will move.`)) return;
    setError(''); setBusy(true);
    try { const { transaction } = await api.confirm(intent.id); setResult(transaction); setStep(4); await refresh(); say(`${t.status[transaction.status]}. ${t.demo}`); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function cancelPayment() {
    setError(''); setBusy(true);
    try { const { transaction } = await api.cancel(intent.id); setResult(transaction); setStep(4); await refresh(); say(t.status.cancelled); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function reset() { setStep(1); setRecipient(null); setAmount(''); setNote(''); setIntent(null); setResult(null); setError(''); }
  const who = step === 1 ? t.who : step === 2 ? t.amount : step === 3 ? t.review : t.status[result?.status || 'success'];

  if (!unlocked) return <div className="app-shell auth-shell"><header className="topbar"><a className="brand" href="#" aria-label="VoiceGuide home"><span className="brand-icon"><Icon name="mic"/></span><span>voiceguide<span className="brand-dot">.</span></span></a></header><main className="auth-main"><section className="auth-card"><div className="guide-icon"><Icon name="mic"/></div><div className="section-kicker">A PRIVATE SPACE ON THIS DEVICE</div><h1>{authMode==='signup'?'Create your account':'Welcome back'}</h1><p className="auth-copy">Set an app access PIN to unlock this VoiceGuide screen. This PIN does not authorize payments and is not your UPI PIN.</p><form onSubmit={submitAuth} className="auth-form">{authMode==='signup'&&<><label>Your name<input required minLength="2" value={authForm.name} onChange={e=>setAuthForm({...authForm,name:e.target.value})} autoComplete="name"/></label><label>Email address<input required type="email" value={authForm.email} onChange={e=>setAuthForm({...authForm,email:e.target.value})} autoComplete="email"/></label></>}<label>6-digit app access PIN<input required inputMode="numeric" type="password" pattern="[0-9]{6}" maxLength="6" value={authForm.pin} onChange={e=>setAuthForm({...authForm,pin:e.target.value.replace(/\D/g,'').slice(0,6)})} autoComplete="off"/></label>{authMode==='signup'&&<label>Confirm app access PIN<input required inputMode="numeric" type="password" pattern="[0-9]{6}" maxLength="6" value={authForm.confirmPin} onChange={e=>setAuthForm({...authForm,confirmPin:e.target.value.replace(/\D/g,'').slice(0,6)})} autoComplete="off"/></label>}{authError&&<p className="auth-error" role="alert">{authError}</p>}<p className="pin-note">App access only. Never enter your bank or UPI PIN here. This simple sample sign-in is stored only in this browser and is not a production account system.</p><button className="next-btn auth-submit">{authMode==='signup'?'Create account':'Unlock VoiceGuide'} <span>→</span></button></form><button className="text-action" onClick={()=>{setAuthMode(authMode==='signup'?'login':'signup');setAuthForm({name:'',email:'',pin:'',confirmPin:''});setAuthError('')}}>{authMode==='signup'?'Already set up here? Sign in':'First time here? Create account'}</button></section></main><footer><span>VoiceGuide · Accessible payment guidance</span><span>No real payments are processed</span></footer></div>;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="VoiceGuide home"><span className="brand-icon"><Icon name="mic"/></span><span>voiceguide<span className="brand-dot">.</span></span></a><div className="top-right"><span className="secure-pill"><span className="secure-dot"/> Simulated payments · no money moved</span><button className="help-btn" onClick={() => say(t.reviewHint)} aria-label={t.repeat}>? <span className="help-word">Help</span></button><button className="text-action" onClick={()=>{sessionStorage.removeItem('voiceguide.unlocked');setUnlocked(false)}}>Lock</button></div></header>
    <main id="top"><section className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line"/> A LITTLE HELP GOES A LONG WAY</div><h1>Payments, at <span>your pace.</span></h1><p className="hero-copy">Just tell us what you need. We’ll guide you, one simple step at a time.</p></div><div className="hero-art" aria-hidden="true"><div className="art-orbit"/><div className="art-card"><div className="art-person">👵🏽</div><div className="art-wave"><i/><i/><i/><i/><i/><i/><i/></div><span>Namaste!</span></div><span className="spark spark-one">✳</span><span className="spark spark-two">✦</span></div></section>
      <section className="workspace"><aside className="guide-card"><div className="card-top"><div className="guide-icon"><Icon name="mic"/></div><div><div className="guide-overline">YOUR VOICE GUIDE</div><h2>I'm here with you.</h2></div><span className="online-dot"/></div><p className="guide-intro">{t.intro}</p><button className={`listen-btn ${listening ? 'listening' : ''}`} onClick={startVoice} disabled={busy}><span className="listen-icon"><Icon name="mic"/></span>{listening ? 'Listening…' : t.speak}<span className="listen-arrow">→</span></button><div className="or-divider"><span/>or type below<span/></div><form className="voice-form" onSubmit={e => { e.preventDefault(); if (announcement) parseVoice(announcement); }}><label className="sr-only" htmlFor="voiceRequest">Type a request</label><input id="voiceRequest" value={announcement} onChange={e => setAnnouncement(e.target.value)} placeholder="e.g. Send 500 to Anita"/><button type="submit" aria-label="Send request"><Icon name="send"/></button></form><div className="language-row"><span>Speak in</span><div className="language-control" role="group" aria-label="Choose language">{[['en','English'],['hi','हिन्दी'],['hinglish','Hinglish']].map(([key,label])=><button key={key} className={`lang ${lang===key?'active':''}`} onClick={()=>setLang(key)}>{label}</button>)}</div></div><div className="privacy-note"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> Never enter or share your UPI PIN here.</div></aside>
        <section className="payment-card" aria-live="polite"><div className="payment-heading"><div><div className="section-kicker">SIMPLE &amp; SECURE</div><h2>Send money</h2></div><div className="upi-mark"><span className="upi-dot dot-orange"/><span className="upi-dot dot-purple"/><span className="upi-dot dot-green"/> UPI</div></div>
          <div className="progress-wrap"><div className="progress-label"><span>{step < 4 ? `STEP ${step} OF 3` : 'COMPLETE'}</span><span className="progress-caption">{who}</span></div><div className="progress-track"><div className="progress-fill" style={{width:`${Math.min(step,3)*33.333}%`}}/></div></div>
          <div className="step-content">
            {error && <div className="error-box" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss">×</button></div>}
            {step===1 && <><label className="field-label" htmlFor="recipientSearch">{t.who}</label><p className="field-hint">{t.choose}</p><div className="contact-search"><Icon name="search"/><input id="recipientSearch" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or UPI ID"/></div><div className="contact-list">{filtered.map(r=><button key={r.id} className={`contact-chip ${recipient?.id===r.id?'selected':''}`} onClick={()=>setRecipient(r)} aria-pressed={recipient?.id===r.id}><span className="avatar">{r.name.slice(0,1).toUpperCase()}</span><span><span className="contact-name">{r.name}</span><span className="contact-relation">{r.relation || r.upiId}</span></span></button>)}</div>{!filtered.length && <p className="field-hint">No saved contacts match. Add a recipient below.</p>}<button className="text-action" onClick={()=>setShowAdd(v=>!v)}>{showAdd?'−':'＋'} {t.addNew}</button>{showAdd && <form className="add-form" onSubmit={addRecipient}><input required minLength="2" maxLength="80" placeholder="Full name" aria-label="Recipient name" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/><input required maxLength="100" placeholder="name@bank" aria-label="UPI ID" value={draft.upiId} onChange={e=>setDraft({...draft,upiId:e.target.value})}/><input maxLength="60" placeholder="Relationship (optional)" aria-label="Relationship" value={draft.relation} onChange={e=>setDraft({...draft,relation:e.target.value})}/><button className="small-submit" disabled={busy}>{busy?'…':t.add}</button></form>}</>}
            {step===2 && <><label className="field-label" htmlFor="amountInput">{t.amount}</label><p className="field-hint">{t.amountHint}</p><div className="amount-wrap"><span className="currency-symbol">₹</span><input className="amount-input" id="amountInput" type="number" inputMode="decimal" min="1" max="100000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></div><div className="quick-amounts">{[100,500,1000,2000].map(n=><button key={n} className={`quick-amount ${amount===String(n)?'selected':''}`} onClick={()=>setAmount(String(n))}>₹{n.toLocaleString('en-IN')}</button>)}</div><label className="field-label note-label" htmlFor="paymentNote">{t.note}</label><input className="note-input" id="paymentNote" value={note} maxLength="120" onChange={e=>setNote(e.target.value)} placeholder={t.notePlaceholder}/></>}
            {step===3 && intent && <><label className="field-label">{t.review}</label><p className="field-hint">{t.reviewHint}</p><div className="review-box"><div className="review-person"><span className="avatar">{recipient.name.slice(0,1).toUpperCase()}</span><span><strong>{recipient.name}</strong><small>{recipient.upiId}</small></span></div><div className="review-amount">₹{Number(intent.amountRupees).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>{note&&<div className="review-purpose">{note}</div>}<div className="review-note">🔒 {t.reviewHint}</div></div><div className="demo-warning">{t.demo}</div></>}
            {step===4 && result && <div className="done-state"><div className="done-icon">{result.status==='success'?'✓':result.status==='cancelled'?'×':'!'}</div><h3>{t.status[result.status]}</h3><p>{t.demo}</p><p className="transaction-reference">{t.reference}: <strong>{result.reference}</strong></p><p className="field-hint">{t.statusHelp}</p></div>}
          </div>
          <div className="flow-footer">{step===1?<button className="back-btn" disabled>← {t.back}</button>:<button className="back-btn" onClick={()=>{setError('');setStep(step===4?1:step-1)}}>← {t.back}</button>}<span className="secure-caption">🔒 You’re in control</span>{step===1?<button className="next-btn" disabled={!recipient} onClick={()=>setStep(2)}>{t.continue} <span>→</span></button>:step===2?<button className="next-btn" disabled={!recipient||!Number(amount)||Number(amount)>100000||busy} onClick={reviewPayment}>{busy?t.loading:t.next} <span>→</span></button>:step===3?<div className="action-group"><button className="cancel-btn" disabled={busy} onClick={cancelPayment}>{t.cancel}</button><button className="next-btn" disabled={busy} onClick={confirmPayment}>{busy?t.loading:t.confirm} <span>✓</span></button></div>:<button className="next-btn" onClick={reset}>Send another <span>→</span></button>}</div>
        </section></section>
      <section className="history-card"><div className="history-title"><div><div className="section-kicker">YOUR ACTIVITY</div><h2>{t.history}</h2></div><button className="text-action" onClick={()=>say(t.statusHelp)} aria-label={t.repeat}>ⓘ</button></div>{history.length? <div className="history-list">{history.slice(0,5).map(tx=><div className="history-row" key={tx.id}><span className="history-avatar">{tx.status==='success'?'✓':'↗'}</span><span className="history-main"><strong>{tx.recipientName}</strong><small>{new Date(tx.createdAt).toLocaleString(lang==='hi'?'hi-IN':'en-IN',{dateStyle:'medium',timeStyle:'short'})} · {tx.reference}</small></span><span className="history-end"><strong>₹{Number(tx.amountRupees).toLocaleString('en-IN')}</strong><small className={`status-${tx.status}`}>{t.status[tx.status]}</small></span></div>)}</div>:<p className="empty-history">{history.length===0?t.historyEmpty:t.loading}</p>}<p className="history-help">{t.statusHelp}</p></section>
      <section className="trust-row"><div className="trust-item"><span className="trust-check">✓</span> You’ll review before sending</div><span className="trust-separator"/><div className="trust-item"><span className="trust-check">✓</span> No PIN requested here</div><span className="trust-separator"/><div className="trust-item"><span className="trust-check">✓</span> Simulated payments only</div></section>
    </main><footer><span>Made with care, for everyone. <span className="footer-heart">♥</span></span><span>{t.demo}</span></footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
