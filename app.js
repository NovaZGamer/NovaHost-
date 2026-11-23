const $ = (s) => document.querySelector(s);
let token = localStorage.getItem("nh_token");
let currentUser = null;
let plans = [];
const money = n => "₹" + Number(n).toLocaleString("en-IN");
function toast(message){const t=$("#toast");t.textContent=message;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2800)}
async function api(url, options={}) {
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(token) headers.Authorization="Bearer "+token;
  const r=await fetch("/api"+url,{...options,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Request failed");
  return data;
}
function openModal(html){$("#modalContent").innerHTML=html;$("#modalBackdrop").classList.add("open")}
function closeModal(){$("#modalBackdrop").classList.remove("open")}
$("#modalClose").onclick=closeModal;$("#modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal()});
function authModal(mode="login"){
  const register=mode==="register";
  openModal(`<h2>${register?"Create your NovaHost account":"Welcome back"}</h2><p>${register?"Join NovaHost and launch your Minecraft community.":"Log in to manage your servers and account."}</p>
  ${register?'<div class="field"><label>USERNAME</label><input id="authName" maxlength="24" placeholder="Your username"></div>':""}
  <div class="field"><label>EMAIL</label><input id="authEmail" type="email" placeholder="you@example.com"></div>
  <div class="field"><label>PASSWORD</label><input id="authPassword" type="password" placeholder="${register?"At least 10 characters":"Your password"}"></div>
  <button class="btn btn-primary" id="authSubmit">${register?"Create account":"Log in"} →</button>
  <div class="switch-auth">${register?"Already have an account?":"New to NovaHost?"} <button id="authSwitch">${register?"Log in":"Create account"}</button></div>`);
  $("#authSwitch").onclick=()=>authModal(register?"login":"register");
  $("#authSubmit").onclick=async()=>{
    try{
      const body={email:$("#authEmail").value,password:$("#authPassword").value};
      if(register)body.username=$("#authName").value;
      const data=await api("/auth/"+(register?"register":"login"),{method:"POST",body:JSON.stringify(body)});
      token=data.token;localStorage.setItem("nh_token",token);currentUser=data.user;closeModal();await loadDashboard();toast("Welcome to NovaHost, "+currentUser.username+"!");
    }catch(e){toast(e.message)}
  };
}
$("#loginOpen").onclick=()=>authModal("login");$("#registerOpen").onclick=()=>authModal("register");$("#ctaRegister").onclick=()=>authModal("register");
function planCard(p){
 return `<article class="plan-card ${p.key==="pro"?"popular":""}">${p.key==="pro"?'<span class="popular-label">MOST POPULAR</span>':""}<h3>${p.name}</h3><p class="plan-desc">${p.key==="free"?"For small worlds & testing":p.key==="starter"?"For growing SMPs":p.key==="pro"?"For active communities":"For ambitious networks"}</p><div class="price">${p.price?money(p.price):"Free"}<small>${p.price?"/ month":"forever*"}</small></div><div class="plan-spec"><div><span>Memory</span><b>${p.ram/1024} GB RAM</b></div><div><span>Storage</span><b>${p.disk/1024} GB</b></div><div><span>CPU limit</span><b>${p.cpu}%</b></div><div><span>Backups</span><b>${p.backups}</b></div><div><span>Databases</span><b>${p.databases}</b></div></div><button class="btn ${p.key==="pro"?"btn-primary":"btn-ghost"}" data-plan="${p.key}">${p.key==="free"?"Start for free":"Choose "+p.name}</button></article>`;
}
async function loadPlans(){
 try{plans=await api("/plans");$("#planGrid").innerHTML=plans.map(planCard).join("");document.querySelectorAll("[data-plan]").forEach(b=>b.onclick=()=>choosePlan(b.dataset.plan))}
 catch(e){toast(e.message)}
}
function choosePlan(key){
 if(!token){authModal("register");return}
 const p=plans.find(x=>x.key===key);
 openModal(`<h2>${key==="free"?"Create a free server":"Choose "+p.name}</h2><p>${p.ram/1024} GB RAM · ${p.disk/1024} GB storage · ${p.price?money(p.price)+"/month":"No charge"}</p>
 <div class="field"><label>SERVER NAME</label><input id="serverName" maxlength="40" value="My Minecraft Server"></div>
 ${p.price?`<p>Available account credit: <b>${money(currentUser?.balance||0)}</b>. If you need credit, create a pending order and ask your hosting administrator to confirm your payment.</p>`:""}
 <button class="btn btn-primary" id="provisionBtn">${p.price?"Create server using account credit":"Create free server"} →</button>`);
 $("#provisionBtn").onclick=async()=>{
  try{
   const b=$("#provisionBtn");b.disabled=true;b.textContent="Provisioning...";
   const data=await api("/servers",{method:"POST",body:JSON.stringify({plan:key,name:$("#serverName").value})});
   closeModal();toast(data.message);await loadDashboard();
  }catch(e){toast(e.message);const b=$("#provisionBtn");if(b){b.disabled=false;b.textContent="Try again"}}
 };
}
async function loadDashboard(){
 if(!token){$("#serverRows").textContent="Log in to load your server list.";return}
 try{
  const data=await api("/me");currentUser=data.user;
  $("#demoServerCount").textContent=data.servers.length;$("#demoBalance").textContent=money(data.user.balance);
  $("#serverRows").innerHTML=data.servers.length?data.servers.map(s=>`<div class="server-row"><div><b>${escapeHtml(s.name)}</b><small>${s.ram_mb/1024} GB RAM · ${escapeHtml(s.status)}</small></div><a href="${escapeAttr(s.panel_url||"#")}" target="_blank" rel="noopener">Open control panel ↗</a></div>`).join(""):`No servers yet. Choose a plan above to create your first server.`;
  $("#loginOpen").textContent=data.user.username;
  $("#registerOpen").textContent=data.user.role==="admin"?"Admin panel":"Account";
  $("#registerOpen").onclick=data.user.role==="admin"?adminModal:accountModal;
 }catch(e){localStorage.removeItem("nh_token");token=null;toast(e.message)}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escapeAttr(s){return escapeHtml(s)}
function accountModal(){
 openModal(`<h2>Your account</h2><p>Signed in as ${escapeHtml(currentUser?.email||"")}</p><p>Balance: <b>${money(currentUser?.balance||0)}</b></p><button class="btn btn-ghost" id="logoutBtn">Log out</button>`);
 $("#logoutBtn").onclick=()=>{localStorage.removeItem("nh_token");token=null;currentUser=null;closeModal();$("#loginOpen").textContent="Log in";$("#registerOpen").textContent="Get started";$("#registerOpen").onclick=()=>authModal("register");$("#serverRows").textContent="Log in to load your server list.";toast("Logged out")};
}
async function adminModal(){
 try{
  const d=await api("/admin/overview");
  openModal(`<h2>Admin control center</h2><p>${d.stats.users} users · ${d.stats.servers} servers · ${d.stats.pendingOrders} pending orders</p>
  <div class="admin-actions"><button class="btn btn-ghost" id="adminUsers">Users (${d.users.length})</button><button class="btn btn-ghost" id="adminOrders">Orders (${d.orders.length})</button><button class="btn btn-ghost" id="adminServers">Servers (${d.servers.length})</button></div><div id="adminContent"></div><div class="field"><label>ADD ACCOUNT CREDIT — USER ID</label><input id="creditUser" type="number" placeholder="User ID"></div><div class="field"><label>AMOUNT (₹)</label><input id="creditAmount" type="number" placeholder="Amount"></div><button class="btn btn-primary" id="creditBtn">Add credit</button><p class="switch-auth"><button id="logoutAdmin">Log out</button></p>`);
  const content=$("#adminContent");
  $("#adminUsers").onclick=()=>content.innerHTML=`<table class="admin-table"><tr><th>ID / USER</th><th>EMAIL</th><th>BALANCE</th></tr>${d.users.map(u=>`<tr><td>${u.id} / ${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td><td>${money(u.balance)}</td></tr>`).join("")}</table>`;
  $("#adminOrders").onclick=()=>content.innerHTML=`<table class="admin-table"><tr><th>ORDER</th><th>USER</th><th>AMOUNT</th><th>STATUS</th></tr>${d.orders.map(o=>`<tr><td>#${o.id}</td><td>${escapeHtml(o.email)}</td><td>${money(o.amount)}</td><td>${o.status==="pending"?`<button class="btn btn-small btn-primary" data-approve="${o.id}">Approve</button>`:o.status}</td></tr>`).join("")}</table>`;
  $("#adminServers").onclick=()=>content.innerHTML=`<table class="admin-table"><tr><th>SERVER</th><th>OWNER</th><th>PLAN</th><th>RAM</th></tr>${d.servers.map(s=>`<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.email)}</td><td>${s.plan_key}</td><td>${s.ram_mb/1024} GB</td></tr>`).join("")}</table>`;
  content.addEventListener("click",async e=>{const id=e.target.dataset.approve;if(id){try{await api("/admin/orders/"+id+"/approve",{method:"POST",body:"{}"});toast("Order approved");await adminModal()}catch(err){toast(err.message)}}});
  $("#creditBtn").onclick=async()=>{try{await api("/admin/users/"+$("#creditUser").value+"/credit",{method:"POST",body:JSON.stringify({amount:Number($("#creditAmount").value)})});toast("Credit added");await adminModal()}catch(e){toast(e.message)}};
  $("#logoutAdmin").onclick=()=>{localStorage.removeItem("nh_token");token=null;currentUser=null;closeModal();location.reload()};
 }catch(e){toast(e.message)}
}
$("#createOpen").onclick=()=>{if(!token)authModal("login");else choosePlan("free")};
document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(b){navigator.clipboard?.writeText(b.dataset.copy);toast("Copied") }});
$("#year").textContent=new Date().getFullYear();
loadPlans();loadDashboard();
