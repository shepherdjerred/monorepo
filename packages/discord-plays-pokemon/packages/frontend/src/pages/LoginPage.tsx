import { Login } from "../stories/Login";

export function LoginPage({ handleLogin }: { handleLogin: (token: string) => void }) {
  return <Login handleLogin={handleLogin} />;
}
