import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "./style.css";

import DashboardView from "./views/DashboardView.vue";
import FactsView from "./views/FactsView.vue";
import FactDetailView from "./views/FactDetailView.vue";
import AntsView from "./views/AntsView.vue";
import AntDetailView from "./views/AntDetailView.vue";
import EventsView from "./views/EventsView.vue";
import AdminView from "./views/AdminView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: DashboardView },
    { path: "/facts", component: FactsView },
    { path: "/facts/:id", component: FactDetailView, props: true },
    { path: "/ants", component: AntsView },
    { path: "/ants/:id", component: AntDetailView, props: true },
    { path: "/events", component: EventsView },
    { path: "/admin", component: AdminView },
  ],
});

createApp(App).use(router).mount("#app");
