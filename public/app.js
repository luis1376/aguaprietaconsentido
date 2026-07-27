(function () {
  'use strict';

  const CATEGORY_LABELS = {
    politica: 'Política Local',
    frontera: 'Frontera',
    comunidad: 'Comunidad',
    economia: 'Economía',
    seguridad: 'Seguridad'
  };

  function getVisitorId() {
    let id = localStorage.getItem('apcs_visitor_id');
    if (!id) {
      id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('apcs_visitor_id', id);
    }
    return id;
  }
  const VISITOR_ID = getVisitorId();

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0] || '').join('').toUpperCase() || '?';
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({
      headers: Object.assign({ 'x-visitor-id': VISITOR_ID }, options && options.body ? { 'Content-Type': 'application/json' } : {})
    }, options));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { data });
    return data;
  }

  let confirmResolver = null;
  function confirmDialog(message) {
    return new Promise(resolve => {
      confirmResolver = resolve;
      document.getElementById('confirmModalText').textContent = message;
      document.getElementById('confirmModalOverlay').classList.add('open');
    });
  }
  window.resolveConfirmDialog = function (result) {
    document.getElementById('confirmModalOverlay').classList.remove('open');
    if (confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(result);
    }
  };

  let state = null;
  let currentArticleId = null;
  let currentArticle = null;

  async function loadHome() {
    state = await api('/api/home');
    currentArticleId = state.heroId;
    document.getElementById('activeVisitors').textContent = state.activeVisitorsToday;
    renderAuthWidget();
    renderPublishGate();
    renderArticleGrid();
    renderHeroAndComments(state.hero, state.comments);
    renderPoll();
    renderThreads();
    renderVoices();
    renderActivity();
    renderAbout();
    renderGoals();
    renderPodcasts();
  }

  // =====================================================================
  // QUIÉNES SOMOS
  // =====================================================================
  function renderAbout() {
    const wrap = document.getElementById('aboutContent');
    const content = (state.aboutContent || '').trim();
    wrap.innerHTML = '';
    if (content) {
      content.split(/\n{2,}/).forEach(para => {
        const p = document.createElement('p');
        p.textContent = para;
        wrap.appendChild(p);
      });
    } else {
      wrap.innerHTML = '<p class="pulso-empty">Esta sección todavía no ha sido escrita. Vuelve pronto.</p>';
    }
    document.getElementById('editAboutBtn').style.display = (state.me && state.me.role === 'admin') ? '' : 'none';
  }

  window.openEditAboutModal = function () {
    document.getElementById('aboutTextarea').value = state.aboutContent || '';
    document.getElementById('aboutError').textContent = '';
    document.getElementById('editAboutModalOverlay').classList.add('open');
  };
  window.closeEditAboutModal = function () {
    document.getElementById('editAboutModalOverlay').classList.remove('open');
  };
  window.saveAboutContent = async function () {
    const content = document.getElementById('aboutTextarea').value;
    const errEl = document.getElementById('aboutError');
    errEl.textContent = '';
    try {
      const data = await api('/api/admin/about', { method: 'PUT', body: JSON.stringify({ content }) });
      state.aboutContent = data.content;
      renderAbout();
      closeEditAboutModal();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo guardar';
    }
  };

  // =====================================================================
  // QUÉ QUEREMOS
  // =====================================================================
  function renderGoals() {
    const wrap = document.getElementById('goalsContent');
    const content = (state.goalsContent || '').trim();
    wrap.innerHTML = '';
    if (content) {
      content.split(/\n{2,}/).forEach(para => {
        const p = document.createElement('p');
        p.textContent = para;
        wrap.appendChild(p);
      });
    } else {
      wrap.innerHTML = '<p class="pulso-empty">Esta sección todavía no ha sido escrita. Vuelve pronto.</p>';
    }
    document.getElementById('editGoalsBtn').style.display = (state.me && state.me.role === 'admin') ? '' : 'none';
  }

  window.openEditGoalsModal = function () {
    document.getElementById('goalsTextarea').value = state.goalsContent || '';
    document.getElementById('goalsError').textContent = '';
    document.getElementById('editGoalsModalOverlay').classList.add('open');
  };
  window.closeEditGoalsModal = function () {
    document.getElementById('editGoalsModalOverlay').classList.remove('open');
  };
  window.saveGoalsContent = async function () {
    const content = document.getElementById('goalsTextarea').value;
    const errEl = document.getElementById('goalsError');
    errEl.textContent = '';
    try {
      const data = await api('/api/admin/goals', { method: 'PUT', body: JSON.stringify({ content }) });
      state.goalsContent = data.content;
      renderGoals();
      closeEditGoalsModal();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo guardar';
    }
  };

  // =====================================================================
  // PODCASTS
  // =====================================================================
  function renderPodcasts() {
    const isAdmin = state.me && state.me.role === 'admin';
    const channelBtn = document.getElementById('youtubeChannelBtn');
    if (state.youtubeChannelUrl) {
      channelBtn.href = state.youtubeChannelUrl;
      channelBtn.style.display = '';
    } else {
      channelBtn.style.display = 'none';
    }
    document.getElementById('editYoutubeChannelBtn').style.display = isAdmin ? '' : 'none';
    document.getElementById('addPodcastBtn').style.display = isAdmin ? '' : 'none';
    if (!isAdmin) document.getElementById('podcastForm').classList.remove('open');

    const list = document.getElementById('podcastList');
    list.innerHTML = '';
    if (state.podcasts.length === 0) {
      list.innerHTML = '<p class="pulso-empty">Aún no hay episodios publicados. Vuelve pronto.</p>';
      return;
    }
    state.podcasts.forEach(p => {
      const card = document.createElement('div');
      card.className = 'podcast-card';
      card.innerHTML = `
        <div class="video-frame"><iframe src="https://www.youtube.com/embed/${escapeHtml(p.youtubeId)}" title="${escapeHtml(p.title)}" allowfullscreen loading="lazy"></iframe></div>
        <div class="podcast-card-body">
          <h4></h4>
          <p></p>
          <div class="podcast-card-foot">
            <span>${escapeHtml(p.timeAgo)}</span>
            ${isAdmin ? '<button class="podcast-delete">Borrar</button>' : ''}
          </div>
        </div>`;
      card.querySelector('h4').textContent = p.title;
      card.querySelector('p').textContent = p.description || '';
      const delBtn = card.querySelector('.podcast-delete');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!(await confirmDialog(`¿Borrar el episodio "${p.title}"?`))) return;
          const data = await api(`/api/admin/podcasts/${p.id}`, { method: 'DELETE' });
          state.podcasts = data.podcasts;
          renderPodcasts();
        });
      }
      list.appendChild(card);
    });
  }

  window.togglePodcastForm = function () {
    document.getElementById('podcastForm').classList.toggle('open');
  };

  window.postPodcast = async function () {
    const title = document.getElementById('podcastTitle').value.trim();
    const youtubeUrl = document.getElementById('podcastUrl').value.trim();
    const description = document.getElementById('podcastDescription').value.trim();
    const errEl = document.getElementById('podcastError');
    errEl.textContent = '';
    try {
      const data = await api('/api/admin/podcasts', { method: 'POST', body: JSON.stringify({ title, youtubeUrl, description }) });
      state.podcasts = data.podcasts;
      document.getElementById('podcastTitle').value = '';
      document.getElementById('podcastUrl').value = '';
      document.getElementById('podcastDescription').value = '';
      document.getElementById('podcastForm').classList.remove('open');
      renderPodcasts();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo publicar';
    }
  };

  window.openEditYoutubeModal = function () {
    document.getElementById('youtubeChannelInput').value = state.youtubeChannelUrl || '';
    document.getElementById('youtubeChannelError').textContent = '';
    document.getElementById('editYoutubeModalOverlay').classList.add('open');
  };
  window.closeEditYoutubeModal = function () {
    document.getElementById('editYoutubeModalOverlay').classList.remove('open');
  };
  window.saveYoutubeChannel = async function () {
    const url = document.getElementById('youtubeChannelInput').value.trim();
    const errEl = document.getElementById('youtubeChannelError');
    errEl.textContent = '';
    try {
      const data = await api('/api/admin/youtube-channel', { method: 'PUT', body: JSON.stringify({ url }) });
      state.youtubeChannelUrl = data.url;
      renderPodcasts();
      closeEditYoutubeModal();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo guardar';
    }
  };

  // =====================================================================
  // AUTENTICACIÓN
  // =====================================================================
  function renderAuthWidget() {
    const wrap = document.getElementById('authWidget');
    const me = state.me;
    if (!me) {
      wrap.innerHTML = `
        <div class="auth-guest">
          <button class="btn-ghost" onclick="openAuthModal('login')">Iniciar sesión</button>
          <button class="btn-ghost" onclick="openAuthModal('register')">Registrarme</button>
        </div>`;
      document.getElementById('adminFooterLink').style.display = 'none';
      return;
    }
    const statusLabel = me.status === 'verified' ? 'Verificado' : (me.status === 'pending' ? 'Pendiente de verificación' : 'Cuenta rechazada');
    const pendingBadge = (me.role === 'admin' && state.pendingCount > 0)
      ? ` <span class="notify-badge">${state.pendingCount}</span>` : '';
    wrap.innerHTML = `
      <div class="auth-user">
        <button class="auth-user-btn" onclick="toggleAuthMenu()">
          <span class="avatar">${escapeHtml(initials(me.displayName))}</span>
          <span class="auth-status-dot ${me.status !== 'verified' ? 'pending' : ''}"></span>
          ${escapeHtml(me.displayName)}${pendingBadge}
        </button>
        <div class="auth-menu" id="authMenu">
          <div class="menu-name">${escapeHtml(me.displayName)}</div>
          <div class="menu-status ${me.status !== 'verified' ? 'pending' : ''}">${escapeHtml(statusLabel)}${me.role === 'admin' ? ' · Administrador' : ''}</div>
          ${me.role === 'admin' ? `<button class="menu-item" onclick="openAdminModal()">Panel de verificación${pendingBadge}</button>` : ''}
          <button class="menu-item" onclick="doLogout()">Cerrar sesión</button>
        </div>
      </div>`;
    document.getElementById('adminFooterLink').style.display = me.role === 'admin' ? '' : 'none';
    const footerBadgeHost = document.getElementById('adminFooterLink');
    if (footerBadgeHost && me.role === 'admin') {
      footerBadgeHost.querySelector('a').innerHTML = `Panel admin${pendingBadge}`;
    }
  }

  window.toggleAuthMenu = function () {
    document.getElementById('authMenu').classList.toggle('open');
  };
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('authMenu');
    if (menu && menu.classList.contains('open') && !e.target.closest('.auth-user')) {
      menu.classList.remove('open');
    }
  });

  window.openAuthModal = function (tab) {
    document.getElementById('authModalOverlay').classList.add('open');
    switchAuthTab(tab || 'login');
  };
  window.closeAuthModal = function () {
    document.getElementById('authModalOverlay').classList.remove('open');
  };
  window.switchAuthTab = function (tab) {
    const isLogin = tab === 'login';
    document.getElementById('tabLogin').classList.toggle('active', isLogin);
    document.getElementById('tabRegister').classList.toggle('active', !isLogin);
    document.getElementById('loginPane').style.display = isLogin ? '' : 'none';
    document.getElementById('registerPane').style.display = isLogin ? 'none' : '';
    if (!isLogin) loadCaptcha();
  };

  let currentCaptchaToken = null;
  async function loadCaptcha() {
    try {
      const data = await api('/api/captcha');
      currentCaptchaToken = data.token;
      document.getElementById('captchaQuestion').textContent = data.question;
      document.getElementById('captchaAnswerInput').value = '';
    } catch (e) { /* ignore */ }
  }

  window.doLogin = async function () {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      state.me = data.user;
      closeAuthModal();
      await loadHome();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo iniciar sesión';
    }
  };

  window.doRegister = async function () {
    const displayName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const colonia = document.getElementById('regColonia').value.trim();
    const bio = document.getElementById('regBio').value.trim();
    const website = document.getElementById('regWebsite').value;
    const captchaAnswer = document.getElementById('captchaAnswerInput').value.trim();
    const errEl = document.getElementById('registerError');
    errEl.textContent = '';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ displayName, email, password, colonia, bio, website, captchaToken: currentCaptchaToken, captchaAnswer })
      });
      state.me = data.user;
      closeAuthModal();
      await loadHome();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo crear la cuenta';
      loadCaptcha();
    }
  };

  window.doLogout = async function () {
    await api('/api/auth/logout', { method: 'POST' });
    state.me = null;
    await loadHome();
  };

  // =====================================================================
  // PANEL ADMIN
  // =====================================================================
  window.openAdminModal = async function () {
    document.getElementById('adminModalOverlay').classList.add('open');
    switchAdminTab('accounts');
  };
  window.closeAdminModal = function () {
    document.getElementById('adminModalOverlay').classList.remove('open');
  };

  window.switchAdminTab = function (tab) {
    document.getElementById('adminTabAccounts').classList.toggle('active', tab === 'accounts');
    document.getElementById('adminTabReports').classList.toggle('active', tab === 'reports');
    document.getElementById('adminTabPoll').classList.toggle('active', tab === 'poll');
    document.getElementById('adminAccountsPane').style.display = tab === 'accounts' ? '' : 'none';
    document.getElementById('adminReportsPane').style.display = tab === 'reports' ? '' : 'none';
    document.getElementById('adminPollPane').style.display = tab === 'poll' ? '' : 'none';
    if (tab === 'accounts') { loadPendingUsers(); loadVerifiedUsers(); }
    if (tab === 'reports') loadReportedComments();
    if (tab === 'poll') loadPollAdminForm();
  };

  async function loadPendingUsers() {
    const wrap = document.getElementById('adminPendingList');
    wrap.innerHTML = '<p class="pulso-empty">Cargando…</p>';
    try {
      const data = await api('/api/admin/pending-users');
      if (data.users.length === 0) {
        wrap.innerHTML = '<p class="pulso-empty">No hay cuentas pendientes por ahora.</p>';
        return;
      }
      wrap.innerHTML = '';
      data.users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'admin-user-row';
        row.innerHTML = `
          <div class="admin-user-info">
            <b></b>
            <div class="meta"></div>
            <div class="bio"></div>
          </div>
          <div class="admin-actions">
            <button class="approve">Verificar</button>
            <button class="reject">Rechazar</button>
          </div>`;
        row.querySelector('b').textContent = u.displayName;
        row.querySelector('.meta').textContent = `${u.email}${u.colonia ? ' · ' + u.colonia : ''} · se registró ${u.timeAgo}`;
        if (u.bio) row.querySelector('.bio').textContent = u.bio;
        row.querySelector('.approve').addEventListener('click', () => actOnUser(u.id, 'verify', row));
        row.querySelector('.reject').addEventListener('click', () => actOnUser(u.id, 'reject', row));
        wrap.appendChild(row);
      });
    } catch (e) {
      wrap.innerHTML = '<p class="pulso-empty">No se pudo cargar la lista.</p>';
    }
  }

  async function actOnUser(id, action, row) {
    await api(`/api/admin/users/${id}/${action}`, { method: 'POST' });
    row.remove();
    loadHome();
  }

  async function loadVerifiedUsers() {
    const wrap = document.getElementById('adminVerifiedList');
    wrap.innerHTML = '<p class="pulso-empty">Cargando…</p>';
    try {
      const data = await api('/api/admin/verified-users');
      if (data.users.length === 0) {
        wrap.innerHTML = '<p class="pulso-empty">Todavía no hay vecinos verificados.</p>';
        return;
      }
      wrap.innerHTML = '';
      data.users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'admin-user-row';
        row.innerHTML = `
          <div class="admin-user-info">
            <b></b>
            <div class="meta"></div>
          </div>
          <div class="admin-actions">
            <button class="reject">Suspender</button>
          </div>`;
        row.querySelector('b').textContent = u.displayName;
        row.querySelector('.meta').textContent = `${u.email}${u.colonia ? ' · ' + u.colonia : ''}`;
        row.querySelector('.reject').addEventListener('click', async () => {
          if (!(await confirmDialog(`¿Suspender a ${u.displayName}? Ya no podrá publicar noticias hasta que lo vuelvas a verificar.`))) return;
          await api(`/api/admin/users/${u.id}/reject`, { method: 'POST' });
          row.remove();
          loadHome();
        });
        wrap.appendChild(row);
      });
    } catch (e) {
      wrap.innerHTML = '<p class="pulso-empty">No se pudo cargar la lista.</p>';
    }
  }

  async function loadReportedComments() {
    const wrap = document.getElementById('adminReportsList');
    wrap.innerHTML = '<p class="pulso-empty">Cargando…</p>';
    try {
      const data = await api('/api/admin/reported-comments');
      if (data.comments.length === 0) {
        wrap.innerHTML = '<p class="pulso-empty">No hay comentarios reportados.</p>';
        return;
      }
      wrap.innerHTML = '';
      data.comments.forEach(c => {
        const row = document.createElement('div');
        row.className = 'admin-user-row';
        row.innerHTML = `
          <div class="admin-user-info">
            <b></b>
            <div class="meta">${c.reportCount} reporte(s) · ${escapeHtml(c.timeAgo)}</div>
            <div class="bio"></div>
          </div>
          <div class="admin-actions">
            <button class="reject">Borrar</button>
          </div>`;
        row.querySelector('b').textContent = c.author;
        row.querySelector('.bio').textContent = c.text;
        row.querySelector('.reject').addEventListener('click', async () => {
          await api(`/api/comments/${c.id}`, { method: 'DELETE' });
          row.remove();
          if (c.articleId === currentArticleId) await featureArticle(currentArticleId);
        });
        wrap.appendChild(row);
      });
    } catch (e) {
      wrap.innerHTML = '<p class="pulso-empty">No se pudo cargar la lista.</p>';
    }
  }

  function loadPollAdminForm() {
    document.getElementById('pollNewQuestion').value = state.pollQuestion || '';
    document.getElementById('pollAdminError').textContent = '';
    const wrap = document.getElementById('pollOptionInputs');
    wrap.innerHTML = '';
    const currentLabels = state.poll.options.length ? state.poll.options.map(o => o.label) : ['', ''];
    currentLabels.forEach(label => addPollOptionInput(label));
  }

  window.addPollOptionInput = function (value) {
    const wrap = document.getElementById('pollOptionInputs');
    if (wrap.children.length >= 5) return;
    const row = document.createElement('div');
    row.className = 'poll-opt-input-row';
    row.innerHTML = `<input type="text" placeholder="Opción" value="${escapeHtml(value || '')}"><button title="Quitar">✕</button>`;
    row.querySelector('button').addEventListener('click', () => {
      if (wrap.children.length > 2) row.remove();
    });
    wrap.appendChild(row);
  };

  window.publishNewPoll = async function () {
    const question = document.getElementById('pollNewQuestion').value.trim();
    const options = Array.from(document.querySelectorAll('#pollOptionInputs input')).map(i => i.value.trim());
    const errEl = document.getElementById('pollAdminError');
    errEl.textContent = '';
    try {
      const data = await api('/api/admin/poll', { method: 'POST', body: JSON.stringify({ question, options }) });
      state.poll = data.poll;
      state.pollQuestion = data.pollQuestion;
      state.pollVotedOption = null;
      renderPoll();
      closeAdminModal();
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo publicar la encuesta';
    }
  };

  // =====================================================================
  // PUBLICAR NOTICIA
  // =====================================================================
  function renderPublishGate() {
    const wrap = document.getElementById('publishGate');
    const me = state.me;
    if (!me) {
      wrap.innerHTML = `
        <div class="publish-gate">
          <span>Inicia sesión o crea tu perfil de vecino para poder publicar una noticia.</span>
          <div style="display:flex; gap:8px;">
            <button class="btn-ghost" onclick="openAuthModal('login')">Iniciar sesión</button>
            <button class="btn-post" onclick="openAuthModal('register')">Registrarme</button>
          </div>
        </div>`;
      return;
    }
    if (me.status === 'pending') {
      wrap.innerHTML = `<div class="publish-gate"><span>Tu cuenta está pendiente de verificación por un administrador. Te avisaremos cuando puedas publicar.</span></div>`;
      return;
    }
    if (me.status === 'rejected') {
      wrap.innerHTML = `<div class="publish-gate"><span>Tu solicitud de cuenta no fue aprobada. Si crees que es un error, contacta al sitio.</span></div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="publish-gate" style="margin-bottom:14px;">
        <span>Publicando como <b>${escapeHtml(me.displayName)}</b> (vecino verificado).</span>
        <button class="btn-post" onclick="togglePublishForm()">+ Nueva noticia</button>
      </div>
      <div class="publish-form" id="publishForm">
        <div class="row">
          <div class="form-field"><label>Título</label><input id="articleTitle" type="text"></div>
          <div class="form-field" style="max-width:200px;">
            <label>Categoría</label>
            <select id="articleCat">
              <option value="comunidad">Comunidad</option>
              <option value="politica">Política Local</option>
              <option value="frontera">Frontera</option>
              <option value="economia">Economía</option>
              <option value="seguridad">Seguridad</option>
            </select>
          </div>
        </div>
        <div class="form-field"><label>Resumen breve</label><input id="articleDek" type="text" maxlength="220"></div>
        <div class="form-field"><label>Cuerpo de la noticia</label><textarea id="articleBody" rows="6"></textarea></div>
        <p class="form-error" id="articleError"></p>
        <button class="btn-post" style="align-self:flex-start;" onclick="postArticle()">Publicar noticia</button>
      </div>`;
  }

  window.togglePublishForm = function () {
    document.getElementById('publishForm').classList.toggle('open');
  };

  window.postArticle = async function () {
    const title = document.getElementById('articleTitle').value.trim();
    const category = document.getElementById('articleCat').value;
    const dek = document.getElementById('articleDek').value.trim();
    const body = document.getElementById('articleBody').value.trim();
    const errEl = document.getElementById('articleError');
    errEl.textContent = '';
    try {
      await api('/api/articles', { method: 'POST', body: JSON.stringify({ title, category, dek, body }) });
      document.getElementById('articleTitle').value = '';
      document.getElementById('articleDek').value = '';
      document.getElementById('articleBody').value = '';
      document.getElementById('publishForm').classList.remove('open');
      await loadHome();
      document.getElementById('heroSection').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo publicar';
    }
  };

  // =====================================================================
  // HERO + GRID
  // =====================================================================
  function buildArticleCard(a) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.cat = a.category;
    card.dataset.id = a.id;
    card.innerHTML = `
      <div class="eyebrow tag-${a.category}">◆ ${escapeHtml(CATEGORY_LABELS[a.category] || a.category)}</div>
      <h3></h3>
      <p></p>
      <div class="card-foot">
        <span></span>
        <span class="comments-count">💬 ${a.commentCount}</span>
      </div>`;
    card.querySelector('h3').textContent = a.title;
    card.querySelector('p').textContent = a.dek || '';
    const authorSpan = card.querySelector('.card-foot span');
    authorSpan.textContent = `Por ${a.authorName}`;
    if (a.authorVerified) authorSpan.innerHTML += ' <span class="verified-check" title="Vecino verificado">✓</span>';
    card.addEventListener('click', () => featureArticle(a.id));
    return card;
  }

  function renderArticleGrid() {
    const grid = document.getElementById('articleGrid');
    grid.innerHTML = '';
    document.getElementById('gridTitle').textContent = 'Últimas notas';
    document.getElementById('searchBanner').style.display = 'none';
    if (state.articles.length === 0) {
      grid.innerHTML = '<p class="pulso-empty">Todavía no hay notas.</p>';
      return;
    }
    state.articles.forEach(a => {
      if (a.id === currentArticleId) return;
      grid.appendChild(buildArticleCard(a));
    });
    applyCategoryFilter();
  }

  async function runSearch(term) {
    const data = await api(`/api/search?q=${encodeURIComponent(term)}`);
    const grid = document.getElementById('articleGrid');
    grid.innerHTML = '';
    document.getElementById('gridTitle').textContent = 'Resultados de búsqueda';
    document.getElementById('searchTermLabel').textContent = term;
    document.getElementById('searchBanner').style.display = 'flex';
    if (data.articles.length === 0) {
      grid.innerHTML = '<p class="pulso-empty search-empty">No encontramos notas que coincidan con tu búsqueda.</p>';
      return;
    }
    data.articles.forEach(a => grid.appendChild(buildArticleCard(a)));
  }

  window.clearSearch = function () {
    document.getElementById('searchInput').value = '';
    renderArticleGrid();
    document.getElementById('articleGrid').scrollIntoView({ behavior: 'smooth' });
  };

  async function featureArticle(id) {
    currentArticleId = id;
    const data = await api(`/api/articles/${id}`);
    renderHeroAndComments(data.article, data.comments);
    renderArticleGrid();
    document.getElementById('heroSection').scrollIntoView({ behavior: 'smooth' });
  }

  function renderHeroAndComments(article, comments) {
    if (!article) {
      currentArticle = null;
      document.getElementById('heroEyebrow').textContent = '◆ Portada';
      document.getElementById('heroTitle').textContent = 'Todavía no hay noticias publicadas';
      document.getElementById('heroDek').textContent = 'En cuanto un vecino verificado publique la primera nota, aparecerá aquí.';
      document.getElementById('heroBody').textContent = '';
      document.getElementById('heroAvatar').textContent = '··';
      document.getElementById('heroByline').innerHTML = '<b>—</b>';
      document.getElementById('heroTime').textContent = '';
      document.getElementById('statVotes').textContent = '0';
      document.getElementById('statCategory').textContent = '—';
      document.getElementById('heroCommentCount').textContent = '0';
      document.getElementById('statComments').textContent = '0';
      document.getElementById('heroEditBtn').style.display = 'none';
      document.getElementById('heroDeleteBtn').style.display = 'none';
      document.getElementById('commentsBlock').style.display = 'none';
      return;
    }
    document.getElementById('commentsBlock').style.display = '';
    currentArticle = article;
    state.comments = comments;
    document.getElementById('heroEyebrow').className = `eyebrow tag-${article.category}`;
    document.getElementById('heroEyebrow').textContent = `◆ Portada · ${CATEGORY_LABELS[article.category] || article.category}`;
    document.getElementById('heroTitle').textContent = article.title;
    document.getElementById('heroDek').textContent = article.dek || '';
    const bodyEl = document.getElementById('heroBody');
    bodyEl.textContent = article.body || '';
    bodyEl.classList.remove('open');
    document.getElementById('heroExpandBtn').textContent = 'Leer completa';
    document.getElementById('heroAvatar').textContent = initials(article.authorName);
    document.getElementById('heroByline').innerHTML = `<b>${escapeHtml(article.authorName)}</b>${article.authorVerified ? ' <span class="verified-check" title="Vecino verificado">✓</span>' : ''}`;
    document.getElementById('heroTime').textContent = article.timeAgo;
    document.getElementById('statVotes').textContent = article.votes;
    document.getElementById('statCategory').textContent = CATEGORY_LABELS[article.category] || article.category;
    document.getElementById('heroCommentCount').textContent = comments.length;
    document.getElementById('statComments').textContent = comments.length;
    document.getElementById('commentCountLabel').textContent = comments.length;
    document.getElementById('commentsTitle').textContent = `Discusión: ${article.title}`;

    const upBtn = document.getElementById('heroUpvoteBtn');
    upBtn.querySelector('.n').textContent = article.votes;
    upBtn.classList.toggle('filled', article.upvoted);
    upBtn.onclick = () => heroUpvote(article.id);

    const isOwner = state.me && article.authorId === state.me.id;
    const isAdmin = state.me && state.me.role === 'admin';
    document.getElementById('heroEditBtn').style.display = (isOwner || isAdmin) ? '' : 'none';
    document.getElementById('heroDeleteBtn').style.display = isAdmin ? '' : 'none';

    renderComments(comments);
    renderComposerIdentity();
  }

  // =====================================================================
  // EDITAR / BORRAR NOTICIA
  // =====================================================================
  window.openEditArticleModal = function () {
    if (!currentArticle) return;
    document.getElementById('editArticleTitle').value = currentArticle.title;
    document.getElementById('editArticleCat').value = currentArticle.category;
    document.getElementById('editArticleDek').value = currentArticle.dek || '';
    document.getElementById('editArticleBody').value = currentArticle.body || '';
    document.getElementById('editArticleError').textContent = '';
    document.getElementById('editArticleModalOverlay').classList.add('open');
  };
  window.closeEditArticleModal = function () {
    document.getElementById('editArticleModalOverlay').classList.remove('open');
  };
  window.saveArticleEdit = async function () {
    const title = document.getElementById('editArticleTitle').value.trim();
    const category = document.getElementById('editArticleCat').value;
    const dek = document.getElementById('editArticleDek').value.trim();
    const body = document.getElementById('editArticleBody').value.trim();
    const errEl = document.getElementById('editArticleError');
    errEl.textContent = '';
    try {
      await api(`/api/articles/${currentArticle.id}`, { method: 'PUT', body: JSON.stringify({ title, category, dek, body }) });
      closeEditArticleModal();
      await loadHome();
      if (currentArticleId !== state.heroId) await featureArticle(currentArticleId);
    } catch (e) {
      errEl.textContent = e.data && e.data.error ? e.data.error : 'no se pudo guardar';
    }
  };
  window.deleteCurrentArticle = async function () {
    if (!currentArticle) return;
    if (!(await confirmDialog(`¿Borrar la noticia "${currentArticle.title}"? Esto también borra sus comentarios.`))) return;
    await api(`/api/articles/${currentArticle.id}`, { method: 'DELETE' });
    await loadHome();
  };

  window.toggleHeroBody = function () {
    const bodyEl = document.getElementById('heroBody');
    const open = bodyEl.classList.toggle('open');
    document.getElementById('heroExpandBtn').textContent = open ? 'Ocultar' : 'Leer completa';
  };

  async function heroUpvote(articleId) {
    const data = await api(`/api/articles/${articleId}/upvote`, { method: 'POST' });
    document.getElementById('statVotes').textContent = data.votes;
    const btn = document.getElementById('heroUpvoteBtn');
    btn.querySelector('.n').textContent = data.votes;
    btn.classList.toggle('filled', data.upvoted);
    const summary = state.articles.find(a => a.id === articleId);
    if (summary) summary.votes = data.votes;
  }

  // =====================================================================
  // COMENTARIOS
  // =====================================================================
  function renderComposerIdentity() {
    const wrap = document.getElementById('composerIdentity');
    const me = state.me;
    document.getElementById('composerAvatar').textContent = me ? initials(me.displayName) : 'TÚ';
    if (me) {
      wrap.innerHTML = `<p class="composer-as">Comentando como <b>${escapeHtml(me.displayName)}</b>${me.status === 'verified' ? ' <span class="verified-check">✓</span>' : ''}<button class="btn-post" style="margin-left:10px; padding:8px 14px;" onclick="postComment()">Publicar</button></p>`;
    } else {
      wrap.innerHTML = `
        <div class="composer" style="align-items:center;">
          <input id="composerName" class="composer-name" type="text" placeholder="Tu nombre">
          <input id="composerColonia" class="composer-name" type="text" placeholder="Tu colonia (opcional)" style="width:auto; flex:1;">
          <button class="btn-post" onclick="postComment()">Publicar</button>
        </div>`;
    }
  }

  function commentNode(c) {
    const isReply = !!c.parentId;
    const el = document.createElement('div');
    el.className = 'comment' + (isReply ? ' reply' : '');
    el.dataset.id = c.id;
    const badges = [];
    if (c.colonia) badges.push(`<span class="badge colonia">${escapeHtml(c.colonia)}</span>`);
    if (c.badge) badges.push(`<span class="badge">${escapeHtml(c.badge)}</span>`);
    el.innerHTML = `
      <span class="avatar" style="background:${c.badge ? 'var(--dusk)' : 'var(--copper-deep)'}">${escapeHtml(initials(c.author))}</span>
      <div class="c-body">
        <div class="c-meta">
          <span class="c-name">${escapeHtml(c.author)}</span>
          ${badges.join('')}
          <span class="c-time">${escapeHtml(c.timeAgo)}</span>
        </div>
        <p class="c-text"></p>
        <div class="c-actions">
          <span class="vote">
            <button data-dir="1">▲</button><span class="vc">${c.votes}</span><button class="down" data-dir="-1">▼</button>
          </span>
          <button class="link reply-toggle">Responder</button>
          <button class="link report-toggle">Reportar</button>
        </div>
      </div>`;
    el.querySelector('.c-text').textContent = c.text;
    el.querySelectorAll('.vote button').forEach(btn => {
      btn.addEventListener('click', () => voteComment(c.id, Number(btn.dataset.dir), btn));
    });
    el.querySelector('.reply-toggle').addEventListener('click', (e) => toggleReplyBox(e.target, c.id));
    el.querySelector('.report-toggle').addEventListener('click', (e) => reportComment(c.id, e.target));
    return el;
  }

  async function reportComment(id, btn) {
    try {
      await api(`/api/comments/${id}/report`, { method: 'POST' });
      btn.textContent = 'Reportado ✓';
      btn.disabled = true;
      btn.style.opacity = '.6';
    } catch (e) { /* ignore */ }
  }

  function renderComments(comments) {
    const list = document.getElementById('commentList');
    list.innerHTML = '';
    if (comments.length === 0) {
      list.innerHTML = '<p class="pulso-empty">Sé el primero en comentar.</p>';
      return;
    }
    const byParent = new Map();
    comments.forEach(c => {
      const key = c.parentId || 0;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(c);
    });
    function appendChildren(parentId) {
      (byParent.get(parentId) || []).forEach(c => {
        list.appendChild(commentNode(c));
        appendChildren(c.id);
      });
    }
    appendChildren(0);
  }

  async function voteComment(id, dir, btn) {
    try {
      const data = await api(`/api/comments/${id}/vote`, { method: 'POST', body: JSON.stringify({ dir }) });
      btn.closest('.vote').querySelector('.vc').textContent = data.votes;
    } catch (e) { /* ignore */ }
  }

  function toggleReplyBox(linkBtn, parentId) {
    const body = linkBtn.closest('.c-body');
    const existing = body.querySelector('.inline-reply');
    if (existing) { existing.remove(); return; }
    const box = document.createElement('div');
    box.className = 'inline-reply';
    box.style.marginTop = '8px';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '8px';
    const needsName = !state.me;
    box.innerHTML = `
      <textarea style="min-height:34px;border:1.5px solid var(--line);border-radius:3px;padding:8px;font-family:var(--body);font-size:13px;background:var(--sand);" placeholder="Responder…"></textarea>
      ${needsName ? '<input type="text" placeholder="Tu nombre" style="border:1.5px solid var(--line);border-radius:3px;padding:8px;font-size:13px;background:var(--sand);">' : ''}
      <input type="text" name="website" class="hp-field" tabindex="-1" autocomplete="off" aria-hidden="true">`;
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn-post';
    sendBtn.style.padding = '8px 14px';
    sendBtn.style.alignSelf = 'flex-start';
    sendBtn.textContent = 'Enviar';
    sendBtn.onclick = async () => {
      const text = box.querySelector('textarea').value.trim();
      const authorInput = box.querySelector('input[type="text"]:not(.hp-field)');
      const author = authorInput ? authorInput.value.trim() : undefined;
      const website = box.querySelector('.hp-field').value;
      if (!text) return;
      const data = await api('/api/comments', { method: 'POST', body: JSON.stringify({ articleId: currentArticleId, text, author, parentId, website }) });
      state.comments = data.comments;
      state.activity = data.activity;
      state.voices = data.voices;
      renderComments(state.comments);
      renderActivity();
      renderVoices();
      updateCommentCounts();
    };
    box.appendChild(sendBtn);
    body.appendChild(box);
    box.querySelector('textarea').focus();
  }

  function updateCommentCounts() {
    document.getElementById('heroCommentCount').textContent = state.comments.length;
    document.getElementById('statComments').textContent = state.comments.length;
    document.getElementById('commentCountLabel').textContent = state.comments.length;
    const summary = state.articles.find(a => a.id === currentArticleId);
    if (summary) summary.commentCount = state.comments.length;
  }

  window.postComment = async function () {
    const box = document.getElementById('composerBox');
    const text = box.value.trim();
    if (!text) return;
    const nameInput = document.getElementById('composerName');
    const coloniaInput = document.getElementById('composerColonia');
    const author = nameInput ? nameInput.value.trim() : undefined;
    const colonia = coloniaInput ? coloniaInput.value.trim() : undefined;
    const website = document.getElementById('composerWebsite').value;
    const data = await api('/api/comments', { method: 'POST', body: JSON.stringify({ articleId: currentArticleId, text, author, colonia, website }) });
    state.comments = data.comments;
    state.activity = data.activity;
    state.voices = data.voices;
    box.value = '';
    renderComments(state.comments);
    renderActivity();
    renderVoices();
    updateCommentCounts();
  };

  window.toggleComments = function () {
    document.getElementById('commentsBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // =====================================================================
  // ENCUESTA
  // =====================================================================
  function renderPoll() {
    const wrap = document.getElementById('pollOptions');
    const meta = document.getElementById('pollMeta');
    wrap.innerHTML = '';
    if (!state.poll.options || state.poll.options.length === 0) {
      document.getElementById('pollQuestion').textContent = 'Todavía no hay una encuesta activa.';
      wrap.innerHTML = '<p class="pulso-empty">El admin puede publicar la primera desde el panel.</p>';
      meta.textContent = '';
      return;
    }
    document.getElementById('pollQuestion').textContent = state.pollQuestion || '';
    const voted = !!state.pollVotedOption;
    state.poll.options.forEach(o => {
      const div = document.createElement('div');
      div.className = 'poll-opt' + (voted ? ' voted' : '');
      div.innerHTML = `
        <div class="opt-label"><span>${escapeHtml(o.label)}</span><b>${o.pct}%</b></div>
        <div class="opt-bar-track"><div class="opt-bar-fill" style="width:${o.pct}%; ${o.key === state.pollVotedOption ? 'background:var(--prieta);' : ''}"></div></div>`;
      if (!voted) div.addEventListener('click', () => votePoll(o.key));
      wrap.appendChild(div);
    });
    meta.textContent = voted
      ? `Gracias por votar · ${state.poll.total} votos · cierra el domingo`
      : `${state.poll.total} votos · cierra el domingo`;
  }

  async function votePoll(key) {
    try {
      const data = await api('/api/poll/vote', { method: 'POST', body: JSON.stringify({ optionKey: key }) });
      state.poll = data.poll;
      state.pollVotedOption = data.pollVotedOption;
      renderPoll();
    } catch (e) {
      if (e.data && e.data.poll) {
        state.poll = e.data.poll;
        state.pollVotedOption = e.data.pollVotedOption;
        renderPoll();
      }
    }
  }

  // =====================================================================
  // FORO ABIERTO
  // =====================================================================
  function renderThreads() {
    const list = document.getElementById('foroList');
    list.innerHTML = '';
    document.getElementById('threadAuthorRow').style.display = state.me ? 'none' : '';
    if (state.threads.length === 0) {
      list.innerHTML = '<p class="pulso-empty" style="padding:16px 20px;">Aún no hay temas. Inicia el primero.</p>';
      return;
    }
    const isAdmin = state.me && state.me.role === 'admin';
    state.threads.forEach(t => {
      const el = document.createElement('div');
      el.className = 'foro-item';
      el.innerHTML = `
        <div class="foro-votecol">
          <button data-act="up">▲</button>
          <span class="n">${t.votes}</span>
          <span>votos</span>
          ${isAdmin ? '<button class="foro-delete" data-act="del" title="Borrar tema">✕</button>' : ''}
        </div>
        <div class="foro-body">
          <div class="foro-title"></div>
          <div class="foro-meta"><span>iniciado por ${escapeHtml(t.author)}</span><span>· ${escapeHtml(t.category)}</span><span>· ${escapeHtml(t.timeAgo)}</span></div>
        </div>
        <div class="foro-replies">0 respuestas</div>`;
      el.querySelector('.foro-title').textContent = t.title;
      el.querySelector('[data-act="up"]').addEventListener('click', (e) => {
        e.stopPropagation();
        voteThread(t.id, el);
      });
      const delBtn = el.querySelector('[data-act="del"]');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!(await confirmDialog(`¿Borrar el tema "${t.title}"?`))) return;
          await api(`/api/threads/${t.id}`, { method: 'DELETE' });
          el.remove();
        });
      }
      list.appendChild(el);
    });
  }

  async function voteThread(id, el) {
    const data = await api(`/api/threads/${id}/vote`, { method: 'POST' });
    el.querySelector('.foro-votecol .n').textContent = data.votes;
  }

  window.toggleNewThreadForm = function () {
    document.getElementById('newThreadForm').classList.toggle('open');
  };

  window.postThread = async function () {
    const title = document.getElementById('threadTitle').value.trim();
    if (!title) return;
    const category = document.getElementById('threadCat').value;
    const author = document.getElementById('threadAuthor').value.trim();
    const body = document.getElementById('threadBody').value.trim();
    const website = document.getElementById('threadWebsite').value;
    const data = await api('/api/threads', { method: 'POST', body: JSON.stringify({ title, category, author, body, website }) });
    state.threads = data.threads;
    state.activity = data.activity;
    renderThreads();
    renderActivity();
    document.getElementById('threadTitle').value = '';
    document.getElementById('threadAuthor').value = '';
    document.getElementById('threadBody').value = '';
    document.getElementById('newThreadForm').classList.remove('open');
  };

  // =====================================================================
  // VOCES ACTIVAS
  // =====================================================================
  function renderVoices() {
    const wrap = document.getElementById('voicesList');
    wrap.innerHTML = '';
    if (state.voices.length === 0) {
      wrap.innerHTML = '<p class="pulso-empty">Aún no hay comentarios.</p>';
      return;
    }
    state.voices.forEach((v, i) => {
      const row = document.createElement('div');
      row.className = 'voice-row';
      row.innerHTML = `<span class="voice-rank">${String(i + 1).padStart(2, '0')}</span><span class="voice-name"></span><span class="voice-count">${v.n} coment.</span>`;
      row.querySelector('.voice-name').textContent = v.author;
      wrap.appendChild(row);
    });
  }

  // =====================================================================
  // PULSO DEL PUEBLO
  // =====================================================================
  function renderActivity() {
    const wrap = document.getElementById('pulsoFeed');
    wrap.innerHTML = '';
    if (state.activity.length === 0) {
      wrap.innerHTML = '<p class="pulso-empty">Sin actividad todavía.</p>';
      return;
    }
    state.activity.forEach(a => {
      const div = document.createElement('div');
      div.className = 'pulso-item';
      div.innerHTML = `<span>${a.text}</span><span class="pulso-time">${escapeHtml(a.timeAgo)}</span>`;
      wrap.appendChild(div);
    });
  }

  // =====================================================================
  // FILTRO / BÚSQUEDA
  // =====================================================================
  function applyCategoryFilter() {
    const activePill = document.querySelector('.filter-pill.active');
    const cat = activePill ? activePill.dataset.cat : 'todos';
    document.querySelectorAll('#articleGrid .card').forEach(c => {
      c.style.display = (cat === 'todos' || c.dataset.cat === cat) ? '' : 'none';
    });
  }

  window.filterCat = function (cat) {
    document.querySelectorAll('.filter-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.cat === cat);
    });
    applyCategoryFilter();
    document.getElementById('articleGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('utilityDate');
    dateEl.textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    document.getElementById('searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const q = this.value.trim();
        if (!q) { renderArticleGrid(); return; }
        runSearch(q).catch(() => {});
        document.getElementById('articleGrid').scrollIntoView({ behavior: 'smooth' });
      }
    });

    [document.getElementById('authModalOverlay'), document.getElementById('adminModalOverlay'), document.getElementById('editAboutModalOverlay'), document.getElementById('editArticleModalOverlay'), document.getElementById('editGoalsModalOverlay'), document.getElementById('editYoutubeModalOverlay')].forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
    document.getElementById('confirmModalOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) resolveConfirmDialog(false);
    });

    loadHome().catch(err => console.error('Error al cargar el estado', err));
  });
})();
