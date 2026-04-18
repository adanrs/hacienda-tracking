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

  // Bodegas
  getBodegas: () => request('/bodegas'),
  createBodega: (data) => request('/bodegas', { method: 'POST', body: JSON.stringify(data) }),
  updateBodega: (id, data) => request(`/bodegas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBodega: (id) => request(`/bodegas/${id}`, { method: 'DELETE' }),

  // Deshuese
  getDeshuese: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/deshuese${qs ? '?' + qs : ''}`); },
  getDeshueseOne: (id) => request(`/deshuese/${id}`),
  createDeshuese: (data) => request('/deshuese', { method: 'POST', body: JSON.stringify(data) }),
  updateDeshuese: (id, data) => request(`/deshuese/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeshuese: (id) => request(`/deshuese/${id}`, { method: 'DELETE' }),
  uploadDeshuesePdf: async (id, file) => {
    const fd = new FormData();
    fd.append('pdf', file);
    const token = localStorage.getItem('token');
    const API_BASE = import.meta.env.VITE_API_URL || '/api';
    const res = await fetch(`${API_BASE}/deshuese/${id}/pdf`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error al subir PDF');
    return res.json();
  },

  // Primales
  getPrimales: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/primales${qs ? '?' + qs : ''}`); },
  getPrimal: (id) => request(`/primales/${id}`),
  createPrimal: (data) => request('/primales', { method: 'POST', body: JSON.stringify(data) }),
  updatePrimal: (id, data) => request(`/primales/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePrimal: (id) => request(`/primales/${id}`, { method: 'DELETE' }),

  // Custodia
  getCustodia: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/custodia${qs ? '?' + qs : ''}`); },
  recibirCustodia: (data) => request('/custodia/recibir', { method: 'POST', body: JSON.stringify(data) }),
  moverBodega: (data) => request('/custodia/mover', { method: 'POST', body: JSON.stringify(data) }),

  // Maduracion
  getMaduracion: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/maduracion${qs ? '?' + qs : ''}`); },
  getAlertasMaduracion: () => request('/maduracion/alertas'),
  iniciarMaduracion: (primal_id) => request('/maduracion/iniciar', { method: 'POST', body: JSON.stringify({ primal_id }) }),

  // Porcionado
  getPorcionado: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/porcionado${qs ? '?' + qs : ''}`); },
  createPorcionado: (data) => request('/porcionado', { method: 'POST', body: JSON.stringify(data) }),
  deletePorcionado: (id) => request(`/porcionado/${id}`, { method: 'DELETE' }),

  // Cajas
  getCajas: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/cajas${qs ? '?' + qs : ''}`); },
  getCaja: (id) => request(`/cajas/${id}`),
  createCaja: (data) => request('/cajas', { method: 'POST', body: JSON.stringify(data) }),
  updateCaja: (id, data) => request(`/cajas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  cerrarCaja: (id) => request(`/cajas/${id}/cerrar`, { method: 'POST' }),

  // Stickers
  getStickers: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/stickers${qs ? '?' + qs : ''}`); },
  createSticker: (data) => request('/stickers', { method: 'POST', body: JSON.stringify(data) }),
  scanSticker: (codigo_barras) => request('/stickers/scan', { method: 'POST', body: JSON.stringify({ codigo_barras }) }),

  // Ordenes de salida
  getOrdenesSalida: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/ordenes-salida${qs ? '?' + qs : ''}`); },
  getOrdenSalida: (id) => request(`/ordenes-salida/${id}`),
  createOrdenSalida: (data) => request('/ordenes-salida', { method: 'POST', body: JSON.stringify(data) }),
  updateOrdenSalida: (id, data) => request(`/ordenes-salida/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  despacharOrden: (id) => request(`/ordenes-salida/${id}/despachar`, { method: 'POST' }),

  // Devoluciones
  getDevoluciones: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/devoluciones${qs ? '?' + qs : ''}`); },
  createDevolucion: (data) => request('/devoluciones', { method: 'POST', body: JSON.stringify(data) }),
  marcarReprocesada: (id) => request(`/devoluciones/${id}/reprocesar`, { method: 'POST' }),

  // Sacrificio extras
  registrarMarmoleo: (id, data) => request(`/sacrificio/${id}/marmoleo`, { method: 'POST', body: JSON.stringify(data) }),

  // Deshuese prorrateo edicion
  updateDeshuesePrimales: (id, primales, reprorratear = false) =>
    request(`/deshuese/${id}/primales`, { method: 'PUT', body: JSON.stringify({ primales, reprorratear }) }),

  // Ordenes de entrada
  getOrdenesEntrada: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/ordenes-entrada${qs ? '?' + qs : ''}`); },
  getOrdenEntrada: (id) => request(`/ordenes-entrada/${id}`),
  createOrdenEntrada: (data) => request('/ordenes-entrada', { method: 'POST', body: JSON.stringify(data) }),
  recibirOrdenEntrada: (id, items_recibidos = []) =>
    request(`/ordenes-entrada/${id}/recibir`, { method: 'POST', body: JSON.stringify({ items_recibidos }) }),
  deleteOrdenEntrada: (id) => request(`/ordenes-entrada/${id}`, { method: 'DELETE' }),

  // Paqueteria
  getPaqueteria: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/paqueteria${qs ? '?' + qs : ''}`); },
  getPaqueteriaOne: (id) => request(`/paqueteria/${id}`),
  createPaqueteria: (data) => request('/paqueteria', { method: 'POST', body: JSON.stringify(data) }),
  terminarPaqueteria: (id, peso_final_kg) =>
    request(`/paqueteria/${id}/terminar`, { method: 'POST', body: JSON.stringify({ peso_final_kg }) }),
  getPaqueteriaProrrateo: (id) => request(`/paqueteria/${id}/prorrateo`),
  deletePaqueteria: (id) => request(`/paqueteria/${id}`, { method: 'DELETE' }),
};
