'use client';
import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';

function trError(error){
 const m=(error?.message||'').toLowerCase();
 if(m.includes('rate limit')) return 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.';
 if(m.includes('invalid login credentials')) return 'E-posta adresi veya şifre hatalı.';
 if(m.includes('email not confirmed')) return 'E-posta adresin henüz doğrulanmamış. Gelen kutunu kontrol et.';
 if(m.includes('user already registered')) return 'Bu e-posta adresiyle daha önce hesap oluşturulmuş.';
 if(m.includes('password')) return 'Şifreyle ilgili bir sorun oluştu. En az 6 karakter kullandığından emin ol.';
 if(m.includes('email')) return 'E-posta işlemi tamamlanamadı. Adresi kontrol edip tekrar deneyin.';
 return 'İşlem sırasında bir sorun oluştu. Lütfen tekrar deneyin.';
}

export default function Home(){
 const [mode,setMode]=useState('login');
 const [name,setName]=useState('');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [message,setMessage]=useState('');
 const [messageType,setMessageType]=useState('info');
 const [loading,setLoading]=useState(false);
 const [user,setUser]=useState(null);
 useEffect(()=>{supabase.auth.getUser().then(({data})=>setUser(data.user||null));const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setUser(s?.user||null));return()=>subscription.unsubscribe()},[]);
 function show(text,type='info'){setMessage(text);setMessageType(type)}
 async function submit(e){e.preventDefault();setLoading(true);setMessage('');try{if(mode==='register'){const {error}=await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});if(error)throw error;show('Hesabın oluşturuldu. E-posta doğrulaması açıksa gelen kutunu kontrol et.','success')}else{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;show('Giriş başarılı.','success')}}catch(err){show(trError(err),'error')}finally{setLoading(false)}}
 async function resetPassword(){if(!email){show('Önce e-posta adresini yaz.','error');return}const {error}=await supabase.auth.resetPasswordForEmail(email);show(error?trError(error):'Şifre sıfırlama bağlantısı e-posta adresine gönderildi.',error?'error':'success')}
 async function logout(){await supabase.auth.signOut();show('Çıkış yapıldı.','success')}
 if(user){const displayName=user.user_metadata?.full_name?.trim()||user.email?.split('@')[0]||'Öğrenci';return <main className="dashboard"><header className="topbar"><div className="miniBrand"><div className="miniLogo">DH</div><div><strong>Deneme Harmanı</strong><span>Çalışma alanın</span></div></div><button className="ghost" onClick={logout}>Çıkış Yap</button></header><section className="welcome"><div><span className="eyebrow">ANA PANEL</span><h1>Hoş geldin, {displayName} 👋</h1><p>Kaynaklarını ekle, denemelerini oluştur ve gelişimini tek yerden takip et.</p></div><button className="primary action">+ Yeni Deneme Oluştur</button></section><section className="stats"><article><span>Toplam Deneme</span><strong>0</strong><small>İlk denemeni oluştur</small></article><article><span>Yüklenen PDF</span><strong>0</strong><small>Kaynaklarını eklemeye başla</small></article><article><span>Son Net</span><strong>—</strong><small>Henüz sonuç bulunmuyor</small></article></section><section className="workspace"><div className="panel"><div className="panelHead"><div><h2>Hızlı İşlemler</h2><p>Çalışmaya başlamak için bir işlem seç.</p></div></div><div className="quickGrid"><button className="quick"><b>📄</b><span><strong>PDF Yükle</strong><small>Soru kaynaklarını çalışma alanına ekle</small></span><i>›</i></button><button className="quick"><b>📝</b><span><strong>Denemelerim</strong><small>Oluşturduğun denemeleri görüntüle</small></span><i>›</i></button><button className="quick"><b>📊</b><span><strong>Sonuçlarım</strong><small>Netlerini ve gelişimini takip et</small></span><i>›</i></button><button className="quick"><b>⚙️</b><span><strong>Profil ve Ayarlar</strong><small>Hesap bilgilerini düzenle</small></span><i>›</i></button></div></div><aside className="panel"><h2>Son Denemeler</h2><div className="empty"><div>✦</div><strong>Henüz denemen yok</strong><p>İlk denemeni oluşturduğunda burada görünecek.</p><button className="secondary">Deneme Oluştur</button></div></aside></section></main>}
 return <main className="shell"><section className="brand"><div className="logo">DH</div><h1>Deneme Harmanı</h1><p>Kendi kaynaklarından, kendi denemeni oluştur.</p><div className="features"><span>PDF’lerini düzenle</span><span>Karma denemeler oluştur</span><span>Gelişimini takip et</span></div></section><section className="card"><div className="tabs"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setMessage('')}}>Giriş Yap</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setMessage('')}}>Kayıt Ol</button></div><h2>{mode==='login'?'Tekrar hoş geldin':'Aramıza katıl'}</h2><p className="muted">{mode==='login'?'Çalışmalarına kaldığın yerden devam et.':'Kişisel çalışma alanını birkaç saniyede oluştur.'}</p><form onSubmit={submit}>{mode==='register'&&<label>Ad Soyad<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Adın ve soyadın" autoComplete="name"/></label>}<label>E-posta<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="ornek@email.com" autoComplete="email"/></label><label>Şifre<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength="6" placeholder="En az 6 karakter" autoComplete={mode==='login'?'current-password':'new-password'}/></label>{mode==='login'&&<div className="row"><span></span><button className="link" type="button" onClick={resetPassword}>Şifremi unuttum</button></div>}<button className="primary" disabled={loading} type="submit">{loading?'Lütfen bekle...':mode==='login'?'Giriş Yap':'Hesap Oluştur'}</button></form>{message&&<div className={`notice ${messageType}`}>{message}</div>}<div className="secure">🔒 Bilgilerin güvenli şekilde korunur.</div></section></main>
}