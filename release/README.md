# Preparación de CI/CD de SignDrop

La publicación está deshabilitada por `policy.json` y por el validador de
`scripts/release-policy.py`. Cambiar una bandera no activa este circuito:
requiere otra revisión del código y autorización. No hay digest de retorno
inventado, alias flotantes ni publicación desde main, PR o ejecución manual.

CI escanea también el lock para cubrir dependencias compiladas en el navegador
que el inventario npm del runtime podría omitir. Conserva las pruebas de firma
con poppler/qpdf y las suites actuales.
Después construye un único índice OCI linux/amd64 con SBOM/procedencia, lo
escanea antes de escribir en un registro, verifica todos sus blobs y carga
el config ID exacto. Los tests de navegador de escritorio, móvil y WebKit
firman y verifican dentro de ese runtime. El artefacto transferido se vuelve
a verificar, sin reconstruir. El publisher preparado copiaría esos mismos
bytes, firmaría el digest y exigiría certificado del SHA/run/attempt exactos
antes de promover sólo la versión; su gate actual rechaza toda publicación.

El ensayo Docker es una **fixture no firmada del mismo artefacto**: arranque,
assets, navegador, configuración sin identidad (503), recuperación de la
configuración saludable y rechazo de secreto corto. No demuestra compatibilidad
entre versiones ni admisión de producción. Los ensayos del motor en infra usan
pruebas y digests sintéticos exclusivamente en tests; el ejecutor real sigue
cerrado. Un OCI de preparación puede llevar la versión del package actual sin
reescribir la etiqueta histórica publicada `0.1.3`.

## Contrato de datos y retorno pendiente

`browser-and-revocations-sqlite-v1`: documentos, certificados y vault siguen en el navegador (IndexedDB `signdrop`, versión 1); plantillas en localStorage. El servidor conserva únicamente revocaciones y replay ids en SQLite privado, protocolo 1. El contrato de cuenta es `sealed-session-revocations-v2`.

La corrección se prepara en una rama separada sobre #14. Inicialización, corte de sesiones anteriores, errores de almacenamiento y retorno compatible se detallan en [durable-revocations.md](../docs/durable-revocations.md). No se gira el secreto ni se guardan documentos. El retorno conserva el volumen actual; nunca restaura una copia anterior ni usa un binario que ignore las revocaciones. La activación y la pareja de versiones reales siguen pendientes; los gates de `policy.json` permanecen cerrados.
