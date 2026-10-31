import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from "react-router-dom";

import {
  AccountPage,
  AdminPage,
  ForgotPasswordPage,
  OrderDetailPage,
  OrdersPage,
  ResetPasswordPage,
} from "./pages/orders";
import { CartPage, CheckoutPage, HomePage, ListingPage, OrderPlacedPage, ProductPage } from "./pages/shop";
import { AuthPage } from "./pages/signin";
import { StoreProvider } from "./state";
import { Empty, Layout } from "./ui";

import "./styles.css";

/** Every page shares the header and footer; Back returns to where you were scrolled, a new page starts at the top. */
function Shell() {
  return (
    <StoreProvider>
      <Layout>
        <ScrollRestoration />
        <Outlet />
      </Layout>
    </StoreProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/c/:category", element: <ListingPage mode="category" /> },
      { path: "/search", element: <ListingPage mode="search" /> },
      { path: "/p/:slug", element: <ProductPage /> },
      { path: "/cart", element: <CartPage /> },
      { path: "/checkout", element: <CheckoutPage /> },
      { path: "/order-placed/:number", element: <OrderPlacedPage /> },
      { path: "/orders", element: <OrdersPage /> },
      { path: "/orders/:number", element: <OrderDetailPage /> },
      { path: "/signin", element: <AuthPage mode="signin" /> },
      { path: "/signup", element: <AuthPage mode="signup" /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/account", element: <AccountPage /> },
      { path: "/admin", element: <AdminPage /> },
      { path: "*", element: <Empty emoji="🧭" title="Page not found">This page does not exist.</Empty> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
