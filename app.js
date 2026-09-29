const videos = [
{t:"I Survived 100 Days Inside an Active Volcano",c:"LavaLab",views:"2.1M",time:"3 days ago",dur:"18:42",cat:"volcano trending",grad:"linear-gradient(135deg,#ffb800,#ff3d00,#4d0d00)",init:"L"},
{t:"Campfire Steak — 5 Ember Tricks",c:"Campfire Cooks",views:"890K",time:"1 week ago",dur:"12:05",cat:"cooking trending",grad:"linear-gradient(135deg,#ff9d00,#a32e00,#1a0d00)",init:"C"},
{t:"BLAZE Cup Final — Live Watch Party",c:"Blaze Gaming",views:"128K",time:"LIVE",dur:"LIVE",cat:"gaming live",grad:"linear-gradient(135deg,#ff2d00,#7a0e00,#000)",init:"B",live:true},
{t:"Magma LoFi — 24/7 Fireplace Beats",c:"Magma Music",views:"3.4M",time:"1 month ago",dur:"LIVE",grad:"linear-gradient(135deg,#ff6a00,#5a1500,#000)",cat:"music live",init:"M",live:true},
{t:"Forging a Katana in Lava",c:"LavaLab",views:"5.2M",time:"2 weeks ago",dur:"22:17",cat:"trending volcano",grad:"radial-gradient(circle at 50% 80%,#ffe27a,#ff5a00 45%,#2a0a00)",init:"L"},
{t:"$1 vs $100,000 Fireworks Show",c:"Blaze Gaming",views:"8.7M",time:"5 days ago",dur:"15:33",cat:"trending gaming",grad:"linear-gradient(135deg,#fff,#ff8a00 30%,#ff2d00 60%,#1a0000)",init:"$"},
{t:"Building a Cozy Fire Cabin Alone",c:"Campfire Cooks",views:"1.1M",time:"4 days ago",dur:"28:09",cat:"camping",grad:"linear-gradient(135deg,#ffb800,#6b2a00,#0d0600)",init:"F"},
{t:"New FirFall UI — How We Made It Fire",c:"FirFall Tech",views:"45K",time:"12 hours ago",dur:"9:47",cat:"tech",grad:"linear-gradient(135deg,#2af,#ff5a00)",init:"T"},
{t:"1000°C Knife vs Ice Block",c:"LavaLab",views:"12M",time:"1 year ago",dur:"10:21",cat:"trending volcano",grad:"linear-gradient(135deg,#8af,#ff2d00)",init:"K"},
{t:"Night Camping in a Firestorm",c:"Ember Outdoors",views:"670K",time:"6 days ago",dur:"19:55",cat:"camping live",grad:"linear-gradient(135deg,#3a0d00,#ff6a00,#ffefa0)",init:"E"},
{t:"Fire Drums — Volcano Session",c:"Magma Music",views:"980K",time:"2 weeks ago",dur:"4:12",cat:"music",grad:"linear-gradient(135deg,#ff2d00,#ffb800)",init:"D"},
{t:"Speedrunning ABLAZE Any% World Record",c:"Blaze Gaming",views:"310K",time:"1 day ago",dur:"32:40",cat:"gaming",grad:"linear-gradient(135deg,#7a0e00,#ff8a00,#ffe9b0)",init:"S"},
];
const grid=document.getElementById('grid');
const searchInput=document.getElementById('searchInput');
let activeCat='all';
function render(){
 const q=(searchInput.value||'').toLowerCase();
 grid.innerHTML='';
 videos.filter(v=>(activeCat==='all'||v.cat.includes(activeCat))&&(!q||(v.t+v.c).toLowerCase().includes(q))).forEach(v=>{
  const d=document.createElement('div');d.className='card';
  d.innerHTML=`<div class="thumb" style="background:${v.grad}">${v.live?'<span class="live-badge">● LIVE</span>':''}<span class="duration">${v.dur}</span></div><div class="meta"><div class="chan" style="background:${v.grad};filter:saturate(.6) brightness(1.8)">${v.init}</div><div style="flex:1"><h3>${v.t}</h3><p>${v.c}</p><p>${v.views} views • ${v.time}</p></div><button class="like">♡</button></div>`;
  d.querySelector('.like').onclick=e=>{e.stopPropagation();e.target.classList.toggle('liked');e.target.textContent=e.target.classList.contains('liked')?'♥':'♡'};
  d.onclick=()=>alert('Playing on FirFall: '+v.t);
  grid.appendChild(d);
 });
 if(!grid.innerHTML)grid.innerHTML='<p style="color:#8a6f5f">No flames found — try another search.</p>';
}
document.getElementById('chips').onclick=e=>{if(e.target.classList.contains('chip')){document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));e.target.classList.add('active');activeCat=e.target.dataset.cat;render();}};
searchInput.oninput=render;
document.getElementById('menuBtn').onclick=()=>document.getElementById('sidebar').classList.toggle('collapsed');
document.getElementById('heroWatch').onclick=()=>alert('Playing: VOLCANO ERUPTION Live');
render();
