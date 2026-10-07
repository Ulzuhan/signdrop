# Preparación de CI/CD de SignDrop

La publicación está deshabilitada por `policy.json` y por el validador de
`scripts/release-policy.py`. Cambiar una bandera no activa este circuito:
requiere otra revisión del código y autorización. No hay digest de retorno
inventado, alias flotantes ni publicación desde main, PR o ejecución manual.

CI conserva las pruebas de firma con poppler/qpdf y las suites actuales.
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

`browser-storage-v1`: documentos, certificados y vault pertenecen al navegador
(IndexedDB `signdrop`, versión 1); las plantillas usan localStorage. No hay base
ni volumen de documentos del servidor, ni migración SQL ni copia artificial.
Un retorno de imagen debe conservar el mismo origen público, formato de sesión,
clave de sellado y formatos de almacenamiento del navegador. Una modificación
de esos formatos requiere revisión específica y ensayo de una pareja real.

Las revocaciones del proveedor viven en un Map del proceso. Reiniciar puede
rehabilitar una cookie ya revocada hasta que caduque (12 h por defecto, máximo
24 h). Esta fase no modifica autenticación. El circuito no se puede activar
hasta resolverlo en un cambio separado.

Propuesta acotada para ese cambio: mantener el contrato de cookie y persistir
únicamente el instante de revocación por sujeto en un almacén privado, con
escrituras atómicas y durables y carga antes de aceptar sesiones. Definir
retención por la vida máxima de cookie, concurrencia, fallo cerrado si no puede
leer/escribir y compatibilidad de retorno. No guardar PDFs ni certificados.
Validar back-channel → cookie rechazada → reinicio → sigue rechazada; sesiones
posteriores válidas, duplicados/reordenación, expurgo y corrupción. La elección
del almacén y cualquier volumen nuevo necesitan revisión de Compose/retorno;
no se introducen aquí.

## Camino mínimo seguro, aún no autorizado

1. Revisar y completar la corrección separada de revocaciones; repetir CI y
   escaneo fresco. Las dependencias sin parche se documentan; no se declaran
   inexistentes por `ignore-unfixed`.
2. Autorizar una nueva versión (p. ej. 0.1.4, nunca reetiquetar 0.1.3) y una
   política de publicación supervisada sin retorno automático. Publicar el OCI
   exacto probado/escaneado, con firma de tag/SHA/run/attempt/digest y CI terminal.
3. Revisar host sólo con nueva autorización. Validar esa imagen segura como
   ancla, configuración efectiva, UID, recursos, salud local/pública y OIDC;
   preservar el secreto y los datos de navegador. No admitir la imagen antigua
   como baseline por comodidad. Un primer cambio sin pareja segura necesita
   procedimiento supervisado de recuperación, no un retorno automático a ella.
4. Preparar una segunda versión y ensayar actualización y retorno con la pareja
   real firmada sobre los formatos actuales. Registrar digest/config ID y prueba
   de ambas versiones, contratos y run/attempt exactos.
5. Con otra autorización, registrar el ancla/journal privado, activar los gates
   revisados y el timer/notificaciones privados. No ampliar indexación pública.
