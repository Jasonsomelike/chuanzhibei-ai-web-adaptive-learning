import { NextResponse } from "next/server";
import { register, login, logout, getCurrentUser, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

interface AuthBody {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

/** GET：返回当前登录用户，未登录返回 null。 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ user });
  } catch (err) {
    return NextResponse.json(
      { user: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** POST：action = register | login | logout */
export async function POST(request: Request) {
  let body: AuthBody;
  try {
    body = (await request.json()) as AuthBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "logout") {
      await logout();
      return NextResponse.json({ ok: true });
    }

    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (action === "register") {
      const displayName = typeof body.displayName === "string" ? body.displayName : "";
      const result = await register(email, password, displayName);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, field: result.field },
          { status: 400 },
        );
      }
      await setSessionCookie(result.token);
      return NextResponse.json({ ok: true, user: result.user });
    }

    if (action === "login") {
      const result = await login(email, password);
      if (!result.ok) {
        // 统一用 401，不区分「邮箱不存在」与「密码错误」
        return NextResponse.json({ error: result.error }, { status: 401 });
      }
      await setSessionCookie(result.token);
      return NextResponse.json({ ok: true, user: result.user });
    }

    return NextResponse.json({ error: "未知的 action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
