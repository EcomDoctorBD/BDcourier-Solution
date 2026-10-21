import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/courier-settings${url.search}`);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/courier-settings${url.search}`);
};

export default function SettingsRedirectPage() {
  return null;
}
