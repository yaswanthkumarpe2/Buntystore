/**
 * Links that move between pages smoothly: every navigation runs as a view
 * transition (a short crossfade, with the product picture gliding between the
 * list and its page), in browsers that support it. Elsewhere, and for people
 * who ask for less motion, the page simply changes.
 */
import { forwardRef } from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  useNavigate,
  type LinkProps,
  type NavLinkProps,
  type NavigateOptions,
  type To,
} from "react-router-dom";

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
  return <RouterLink ref={ref} viewTransition {...props} />;
});

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(props, ref) {
  return <RouterNavLink ref={ref} viewTransition {...props} />;
});

/** `useNavigate`, with the same smooth transition. */
export function useNav() {
  const navigate = useNavigate();
  return (to: To, options: NavigateOptions = {}) => void navigate(to, { viewTransition: true, ...options });
}

/** The name that lets a product's picture glide between its card and its page. */
export const productTransition = (slug: string) => `p-${slug.replace(/[^a-z0-9-]/gi, "")}`;
