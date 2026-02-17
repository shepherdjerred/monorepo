import { Button } from "./Button";
import { Card } from "./Card";
import { SyntheticEvent, useState } from "react";

export function Login({
  handleLogin,
}: {
  handleLogin: (token: string) => void;
}) {
  const [token, setToken] = useState<string>("");
  function handleInput(event: SyntheticEvent<HTMLInputElement>) {
    setToken(event.currentTarget.value);
  }
  return (
    <Card title="Login">
      <p>
        Run{" "}
        <code className="bg-gray-100 dark:bg-slate-700 p-1.5 rounded">
          /token
        </code>{" "}
        in Discord and paste the result here. This will allow us to associate
        your commands with your Discord account.
      </p>

      <div className="mt-5">
        <label
          htmlFor="token"
          className="block text-sm font-medium leading-6 text-gray-900"
        >
          Authentication Token
        </label>
        <div className="sm:flex sm:items-center">
          <div className="w-full sm:max-w-xs">
            <input
              type="text"
              name="token"
              id="token"
              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              placeholder="123e4567-e89b-12d3-a456-426614174000"
              value={token}
              onInput={handleInput}
            />
          </div>
          <Button onClick={() => handleLogin(token)}>Login</Button>
        </div>
      </div>
    </Card>
  );
}
