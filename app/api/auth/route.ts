import { NextResponse } from "next/server";
import { register, login, logout, manageCredentials, resetPassword, getCurrentUser, setSessionCookie } from "@/lib/auth";
import { MAX_AUTH_BODY_BYTES } from "@/lib/bodyLimit";
import { assertMutationOrigin, readLimitedText } from "@/lib/routeAuth";

export const runtime = "nodejs";

interface AuthBody {
  action?: unknown;
  email?: unknown;
  recovery?: unknown;
  newPassword?: unknown;
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

/**
 * POST：action = register | login | logout
 *
 * 顺序是有意的：先同源、再限量读包、最后才解析。
 * 登录接口本身不需要鉴权，但它是最容易被跨站表单代发（登录 CSRF）与
 * 大包打满内存的入口，因此这两道守卫必须早于任何业务逻辑。
 * 不带 Origin 的服务端调用也会被拒——浏览器之外的调用方请显式带 Origin。
 */
export async function POST(request: Request) {
  const rejected = assertMutationOrigin(request);
  if (rejected) return rejected;

  const raw = await readLimitedText(request, MAX_AUTH_BODY_BYTES);
  if (!raw.ok) return raw.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }
  const body = parsed as AuthBody;

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "logout") {
      await logout();
      return NextResponse.json({ ok: true });
    }

    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    if (action === "reset-password") {
      const error = await resetPassword(email, next, body.recovery);
      return NextResponse.json(error ? { error } : { ok: true }, { status: error ? 400 : 200 });
    }
    if (action === "change-password" || action === "set-recovery") {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      const error = await manageCredentials(user.id, password, next, action === "set-recovery" ? body.recovery ?? null : undefined);
      return NextResponse.json(error ? { error } : { ok: true }, { status: error ? 400 : 200 });
    }
    if (action === "register") {
      const displayName = typeof body.displayName === "string" ? body.displayName : "";
      const result = await register(email, password, displayName, body.recovery);
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
