import { createClient } from "npm:@supabase/supabase-js@2";
const headers = {
  "Access-Control-Allow-Origin": "https://kkotnikk.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, message: string, extra = {}) =>
  new Response(JSON.stringify({ message, ...extra }), { status, headers });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, "Método não permitido.");
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply(401, "Entre no sistema.");
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await service.auth.getUser(authorization.slice(7));
  if (authError || !user) return reply(401, "Sessão inválida.");
  const { data: actor, error: actorError } = await service.from("usuarios").select("perfil,ativo").eq("id", user.id).maybeSingle();
  if (actorError) return reply(500, "Não foi possível verificar seu acesso. Tente novamente.");
  if (actor?.perfil !== "admin" || actor?.ativo !== true) return reply(403, "Somente o Administrador pode criar usuários.");
  let body;
  try { body = await req.json(); } catch { return reply(400, "Dados inválidos."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, "Dados inválidos.");
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const senha = typeof body.senha === "string" ? body.senha : "";
  const perfil = body.perfil;
  const rotas = Array.isArray(body.rotas_coleta_ids) ? body.rotas_coleta_ids : [];
  if (!nome || nome.length > 120) return reply(400, "Informe o nome da pessoa, com até 120 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, "Informe um e-mail válido.");
  if (senha.length < 8 || senha.length > 128) return reply(400, "A senha deve ter entre 8 e 128 caracteres.");
  if (!["admin", "operador_coleta", "operador_conferencia"].includes(perfil)) return reply(400, "Escolha um perfil válido.");
  if ((perfil === "operador_coleta" && rotas.length < 1) || (perfil === "operador_conferencia" && rotas.length > 0)
    || rotas.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0) || new Set(rotas).size !== rotas.length)
    return reply(400, "Escolha rotas existentes e diferentes. Coleta precisa de pelo menos uma rota; Conferência não possui vínculos.");
  for (let inicio = 0; inicio < rotas.length; inicio += 200) {
    const lote = rotas.slice(inicio, inicio + 200);
    const { data: found, error } = await service.from("rotas").select("id").in("id", lote);
    if (error || found?.length !== lote.length) return reply(400, "Todas as rotas escolhidas devem existir.");
  }
  // The password never enters profile metadata, logs, or the database profile.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email, password: senha, email_confirm: true,
  });
  if (createError || !created.user) return reply(400, createError?.code === "email_exists" || createError?.message?.includes("already")
    ? "Já existe uma conta com este e-mail." : "Não foi possível criar a conta. Confira o e-mail e a senha.");
  const { error: profileError } = await service.from("usuarios").insert({
    id: created.user.id, nome, perfil, ativo: typeof body.ativo === "boolean" ? body.ativo : true, rotas_coleta_ids: rotas,
  });
  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return reply(400, "Não foi possível atribuir as permissões. Atualize as rotas e tente novamente.");
  }
  return reply(201, "Usuário individual criado.", { id: created.user.id });
});
