// Configuración del proyecto de Firebase (no es secreta: identifica el proyecto).
export const firebaseConfig = {
  apiKey: 'AIzaSyBGU7LNm1I36GN_vjzOmEHO6yVB1oClMFo',
  authDomain: 'ot-cuadrillas.firebaseapp.com',
  projectId: 'ot-cuadrillas',
  storageBucket: 'ot-cuadrillas.firebasestorage.app',
  messagingSenderId: '936584539568',
  appId: '1:936584539568:web:5f8a5ec142f97629bd3a75'
};

// Cuenta que siempre tiene permisos de supervisor (debe coincidir con firestore.rules).
export const CORREO_ADMIN = 'angelsridi27@gmail.com';

// Los operarios entran con un usuario corto; internamente se usa usuario@DOMINIO.
export const DOMINIO_USUARIOS = 'cuadrillas.app';

// Número de OT que se imprime en el PDF mientras no esté definida la numeración oficial.
// Cuando se defina, poner '' para que el PDF use el número de cada OT.
export const NRO_OT_PDF = 'xxxx-xx-xx';

export const VERSION_APP = '1.4.0';
