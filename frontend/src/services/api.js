const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Sesion expirada');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error en la solicitud');
  }
  return res.json();
}

export const api = {
  // Auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getMe: () => request('/auth/me'),
  changePassword: (current_password, new_password) => request('/auth/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) }),
  getUsuarios: () => request('/auth/usuarios'),
  createUsuario: (data) => request('/auth/usuarios', { method: 'POST', body: JSON.stringify(data) }),
  updateUsuario: (id, data) => request(`/auth/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUsuario: (id) => request(`/auth/usuarios/${id}`, { method: 'DELETE' }),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Animales
  getAnimales: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/animales${qs ? '?' + qs : ''}`);
  },
  getAnimal: (id) => request(`/animales/${id}`),
  createAnimal: (data) => request('/animales', { method: 'POST', body: JSON.stringify(data) }),
  updateAnimal: (id, data) => request(`/animales/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAnimal: (id) => request(`/animales/${id}`, { method: 'DELETE' }),

  // Pesajes
  getPesajes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/pesajes${qs ? '?' + qs : ''}`);
  },
  createPesaje: (data) => request('/pesajes', { method: 'POST', body: JSON.stringify(data) }),
  deletePesaje: (id) => request(`/pesajes/${id}`, { method: 'DELETE' }),

  // Salud
  getEventosSalud: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/salud${qs ? '?' + qs : ''}`);
  },
  createEventoSalud: (data) => request('/salud', { method: 'POST', body: JSON.stringify(data) }),
  deleteEventoSalud: (id) => request(`/salud/${id}`, { method: 'DELETE' }),
  getAlertasSalud: (dias = 30) => request(`/salud/alertas/proximas?dias=${dias}`),

  // Movimientos
  getMovimientos: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/movimientos${qs ? '?' + qs : ''}`);
  },
  createMovimiento: (data) => request('/movimientos', { method: 'POST', body: JSON.stringify(data) }),

  // Reproduccion
  getReproduccion: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reproduccion${qs ? '?' + qs : ''}`);
  },
  createReproduccion: (data) => request('/reproduccion', { method: 'POST', body: JSON.stringify(data) }),
  updateReproduccion: (id, data) => request(`/reproduccion/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Potreros
  getPotreros: () => request('/potreros'),
  getPotrero: (id) => request(`/potreros/${id}`),
  createPotrero: (data) => request('/potreros', { method: 'POST', body: JSON.stringify(data) }),
  updatePotrero: (id, data) => request(`/potreros/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePotrero: (id) => request(`/potreros/${id}`, { method: 'DELETE' }),

  // Transporte
  getTransportes: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/transporte${qs ? '?' + qs : ''}`); },
  createTransporte: (data) => request('/transporte', { method: 'POST', body: JSON.stringify(data) }),
  updateTransporte: (id, data) => request(`/transporte/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Sacrificio
  getSacrificios: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/sacrificio${qs ? '?' + qs : ''}`); },
  getSacrificio: (id) => request(`/sacrificio/${id}`),
  createSacrificio: (data) => request('/sacrificio', { method: 'POST', body: JSON.stringify(data) }),
  updateSacrificio: (id, data) => request(`/sacrificio/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Cortes
  getCortes: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/cortes${qs ? '?' + qs : ''}`); },
  createCorte: (data) => request('/cortes', { method: 'POST', body: JSON.stringify(data) }),
  deleteCorte: (id) => request(`/cortes/${id}`, { method: 'DELETE' }),

  // Timeline
  getTimeline: (animalId) => request(`/animales/${animalId}/timeline`),
};
