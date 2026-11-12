/*
 * Envoltura de fetch para los cuatro portales: agrega el token de sesión a cada llamada a /api
 * y, si el servidor responde 401 (sesión vencida o ausente), regresa al inicio de sesión.
 */
(function () {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = function (url, opciones) {
        const o = Object.assign({}, opciones);
        const esApi = typeof url === 'string' && url.startsWith('/api/');
        if (esApi) {
            const token = localStorage.getItem('token');
            if (token) o.headers = Object.assign({}, o.headers, { Authorization: 'Bearer ' + token });
        }
        return fetchOriginal(url, o).then(function (res) {
            if (esApi && res.status === 401 && url !== '/api/login') {
                localStorage.clear();
                window.location.href = 'index.html';
            }
            return res;
        });
    };
    window.cerrarSesion = function () {
        fetchOriginal('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })
            .finally(function () { localStorage.clear(); window.location.href = 'index.html'; });
    };
    /** Texto seguro para insertar en innerHTML (evita inyectar HTML desde nombres o diagnósticos). */
    window.esc = function (t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    };
})();
