/* Diplomatura en Blockchain: "Lo que vas a construir" como parte de la cadena.
   Los conectores entre las tarjetas se encienden cuando js/bc-cadena.js termina de minar los cuatro bloques
   (evento 'bc:minado' en document). Sin este script quedan apagados y la sección se lee igual. */
(function () {
    'use strict';
    var enlaces = document.querySelectorAll('#proyectos .bc-pr-eslabon');
    if (!enlaces.length) return;
    var minados = {};
    function encender() {
        Array.prototype.forEach.call(enlaces, function (e) { e.classList.add('minado'); });
    }
    function revisar() {
        if ([1, 2, 3, 4].every(function (n) { return minados[n]; })) encender();
    }
    document.addEventListener('bc:minado', function (e) {
        minados[e.detail.n] = true;
        revisar();
    });
    // por si la cadena ya estaba minada cuando se cargó este script
    if (window.bcCadena && window.bcCadena.bloques) {
        window.bcCadena.bloques.forEach(function (b) { if (b.hash) minados[b.n] = true; });
        revisar();
    }
})();
