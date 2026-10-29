import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import {
  AccountPage,
  AdminPage,
  AuthPage,
  ForgotPasswordPage,
  OrderDetailPage,
  OrdersPage,
  ResetPasswordPage,
} from "./pages/orders";
import { CartPage, CheckoutPage, HomePage, ListingPage, OrderPlacedPage, ProductPage } from "./pages/shop";
import { StoreProvider } from "./state";
import { Empty, Layout } from "./ui";

import "./styles.css";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // braces matter: newer browsers make scrollTo return a promise, and an effect may only return a clean-up
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function App() {
  return (
    <Layout>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/c/:category" element={<ListingPage mode="category" />} />
        <Route path="/search" element={<ListingPage mode="search" />} />
        <Route path="/p/:slug" element={<ProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-placed/:number" element={<OrderPlacedPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:number" element={<OrderDetailPage />} />
        <Route path="/signin" element={<AuthPage mode="signin" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Empty emoji="🧭" title="Page not found">This page does not exist.</Empty>} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
