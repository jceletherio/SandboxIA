// Rotas do protótipo — lazy, isoladas sob /prototype. Registradas no app.routes.ts.
// Quando o protótipo for promovido para produção, estas rotas migram para o app real
// e os gateways mock são trocados pelos Http<Domain>Gateway (ver mock-data-contract.md).

import { Routes } from '@angular/router';

export const PROTOTYPE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./orders/orders.component').then((m) => m.OrdersComponent),
  },
  // {
  //   path: 'order-detail',
  //   loadComponent: () => import('./order-detail/order-detail.component').then((m) => m.OrderDetailComponent),
  // },
];

// --- Registro no app.routes.ts (única exceção à regra de não mexer em rotas globais) ---
// import { PROTOTYPE_ROUTES } from './prototype/prototype.routes';
//
// export const routes: Routes = [
//   // ...rotas do app...
//   { path: 'prototype', loadChildren: () => Promise.resolve(PROTOTYPE_ROUTES) },
//   { path: '**', redirectTo: '' },
// ];
