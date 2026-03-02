export async function GET(req: Request) {
  const url = new URL(req.url)
  const owner = url.searchParams.get("owner")
  const name = url.searchParams.get("name")
  const token = url.searchParams.get("token")

  if (!owner || !name) {
    return Response.json({ error: "Missing owner or name" }, { status: 400 })
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers,
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      const message =
        (errorData as { message?: string }).message ||
        `GitHub API returned ${res.status}`
      return Response.json({ error: message }, { status: res.status })
    }

    const data = await res.json()
    return Response.json({
      name: data.name,
      owner: data.owner.login,
      avatar: data.owner.avatar_url,
      defaultBranch: data.default_branch,
      fullName: data.full_name,
      private: data.private,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
