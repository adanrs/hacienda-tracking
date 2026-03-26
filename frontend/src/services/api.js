const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error en la solicitud');
  }
  return res.json();
}

export const api = {
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
};
