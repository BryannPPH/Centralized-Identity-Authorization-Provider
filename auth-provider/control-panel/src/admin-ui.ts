export const ADMIN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Control Panel Admin</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --text: #1f2933;
        --muted: #667085;
        --line: #d9dee7;
        --accent: #1f7a5a;
        --accent-weak: #e8f5ef;
        --danger: #b42318;
        --danger-weak: #fff1f0;
        --success-weak: #edf7ed;
        --warning: #946200;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      header {
        border-bottom: 1px solid var(--line);
        background: var(--panel);
      }

      .header-inner,
      main {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
      }

      .header-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 64px;
      }

      h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
      }

      h2 {
        margin: 0;
        font-size: 16px;
      }

      main {
        padding: 24px 0 40px;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }

      .metric,
      .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
      }

      .metric {
        padding: 14px;
      }

      .metric strong {
        display: block;
        font-size: 24px;
      }

      .metric span,
      .muted {
        color: var(--muted);
      }

      .tabs {
        display: flex;
        gap: 8px;
        margin: 0 0 16px;
        overflow-x: auto;
      }

      .tab {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        cursor: pointer;
        padding: 8px 12px;
        white-space: nowrap;
      }

      .tab.active {
        border-color: var(--accent);
        background: var(--accent-weak);
        color: var(--accent);
        font-weight: 700;
      }

      .panel {
        display: none;
        padding: 0;
        overflow: hidden;
      }

      .panel.active {
        display: block;
      }

      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid var(--line);
        padding: 14px 16px;
      }

      .icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        min-width: 34px;
        min-height: 34px;
        padding: 0;
        font-size: 20px;
        line-height: 1;
      }

      .panel-body {
        padding: 16px;
      }

      [hidden] {
        display: none !important;
      }

      form.grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }

      input,
      select,
      button {
        min-height: 38px;
        border-radius: 6px;
        font: inherit;
      }

      input,
      select {
        width: 100%;
        border: 1px solid var(--line);
        background: #ffffff;
        color: var(--text);
        padding: 8px 10px;
      }

      button {
        border: 1px solid var(--accent);
        background: var(--accent);
        color: #ffffff;
        cursor: pointer;
        padding: 8px 12px;
        font-weight: 700;
      }

      button.secondary {
        border-color: var(--line);
        background: #ffffff;
        color: var(--text);
      }

      button.danger {
        border-color: var(--danger);
        background: var(--danger);
      }

      button.small {
        min-height: 34px;
        padding: 6px 10px;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border-top: 1px solid var(--line);
        padding: 10px 8px;
        text-align: left;
        vertical-align: middle;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .edit-cell {
        min-width: 190px;
      }

      .edit-cell input {
        min-width: 180px;
      }

      .identity {
        display: grid;
        gap: 2px;
      }

      .identity strong {
        font-size: 14px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        border-radius: 999px;
        background: #f3f5f7;
        padding: 3px 9px;
      }

      .inline-select {
        width: auto;
        min-width: 120px;
      }

      .message {
        border: 1px solid transparent;
        border-radius: 999px;
        color: var(--muted);
        min-height: 22px;
        padding: 5px 10px;
      }

      .message.success {
        border-color: #b7dfc7;
        background: var(--success-weak);
        color: var(--accent);
      }

      .message.error {
        border-color: #f3b0aa;
        background: var(--danger-weak);
        color: var(--danger);
      }

      .status-active {
        color: var(--accent);
        font-weight: 700;
      }

      .status-inactive {
        color: var(--warning);
        font-weight: 700;
      }

      .stack {
        display: grid;
        gap: 4px;
      }

      .group-list {
        display: grid;
        gap: 12px;
      }

      .group-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #ffffff;
        overflow: hidden;
      }

      .group-card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px;
        cursor: pointer;
        list-style: none;
      }

      .group-card-head::-webkit-details-marker {
        display: none;
      }

      .dropdown-caret {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        transition: transform 120ms ease;
      }

      .group-card[open] .dropdown-caret {
        transform: rotate(90deg);
      }

      .group-title {
        display: grid;
        gap: 3px;
        min-width: 180px;
      }

      .group-title strong {
        font-size: 15px;
      }

      .group-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .group-details {
        display: grid;
        gap: 14px;
        border-top: 1px solid var(--line);
        padding: 12px;
      }

      .group-row {
        display: grid;
        gap: 6px;
      }

      .group-row-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .group-members {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .member-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: 100%;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: #f8fafb;
        padding: 4px 5px 4px 10px;
      }

      .member-chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .member-chip button {
        min-width: 26px;
        min-height: 26px;
        border-color: var(--danger);
        border-radius: 999px;
        background: #ffffff;
        color: var(--danger);
        padding: 0;
        line-height: 1;
      }

      .group-add {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) auto;
        gap: 8px;
        max-width: 520px;
      }

      .group-edit {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) minmax(200px, 2fr) auto;
        gap: 8px;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
      }

      @media (max-width: 900px) {
        .summary,
        form.grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 640px) {
        .header-inner,
        main {
          width: min(100% - 20px, 1180px);
        }

        .summary,
        form.grid {
          grid-template-columns: 1fr;
        }

        .group-card-head {
          display: grid;
        }

        .group-add,
        .group-edit {
          grid-template-columns: 1fr;
          max-width: none;
        }

        table,
        thead,
        tbody,
        tr,
        th,
        td {
          display: block;
        }

        th {
          display: none;
        }

        td {
          border-top: 0;
          padding: 6px 0;
        }

        tr {
          border-top: 1px solid var(--line);
          padding: 10px 0;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-inner">
        <h1>Control Panel Admin</h1>
        <div id="message" class="message"></div>
      </div>
    </header>
    <main>
      <section id="summary" class="summary"></section>

      <nav class="tabs" aria-label="Admin sections">
        <button class="tab active" data-tab="users">Users</button>
        <button class="tab" data-tab="groups">Groups</button>
        <button class="tab" data-tab="applications">Applications</button>
        <button class="tab" data-tab="audit">Audit Logs</button>
      </nav>

      <section id="users" class="panel active">
        <div class="panel-head">
          <h2>Users</h2>
          <button id="toggle-user-form" class="icon-button" type="button" title="Create user" aria-label="Create user" aria-expanded="false" data-closed-title="Create user" data-open-title="Close create user">+</button>
        </div>
        <div class="panel-body">
          <form id="user-form" class="grid" hidden>
            <input name="name" placeholder="Name" autocomplete="off" required>
            <input name="email" type="email" placeholder="Email" autocomplete="off" required>
            <input name="password" type="password" placeholder="Password" required>
            <select name="status">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <button type="submit">Create User</button>
          </form>
          <div id="users-table"></div>
        </div>
      </section>

      <section id="groups" class="panel">
        <div class="panel-head">
          <h2>Groups</h2>
          <button id="toggle-group-form" class="icon-button" type="button" title="Create group" aria-label="Create group" aria-expanded="false" data-closed-title="Create group" data-open-title="Close create group">+</button>
        </div>
        <div class="panel-body">
          <form id="group-form" class="grid" hidden>
            <input name="name" placeholder="Group name" autocomplete="off" required>
            <input name="description" placeholder="Description" autocomplete="off">
            <button type="submit">Create Group</button>
          </form>
          <div id="groups-table"></div>
        </div>
      </section>

      <section id="applications" class="panel">
        <div class="panel-head">
          <h2>Applications</h2>
        </div>
        <div class="panel-body">
          <form id="application-form" class="grid">
            <input name="name" placeholder="Application name" autocomplete="off" required>
            <input name="clientId" placeholder="Client ID" autocomplete="off" required>
            <input name="clientSecret" placeholder="Client secret" autocomplete="off">
            <select name="status">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <input name="launchUrl" placeholder="Launch URL" autocomplete="off">
            <input name="logoutNotificationUrl" placeholder="Logout notification URL" autocomplete="off" required>
            <button type="submit">Create Application</button>
          </form>
          <div id="applications-table"></div>
        </div>
      </section>

      <section id="audit" class="panel">
        <div class="panel-head">
          <h2>Audit Logs</h2>
          <button id="refresh-audit" class="secondary small" type="button">Refresh Logs</button>
        </div>
        <div class="panel-body">
          <div id="audit-table"></div>
        </div>
      </section>
    </main>

    <script>
      const state = {
        users: [],
        groups: [],
        applications: [],
        auditLogs: [],
        editingUserId: null,
        editingGroupId: null
      };

      const message = document.getElementById("message");

      function setMessage(text, type) {
        message.textContent = text;
        message.className = "message" + (type ? " " + type : "");
      }

      async function api(path, options) {
        const requestOptions = options || {};
        const headers = new Headers(requestOptions.headers || {});

        if (requestOptions.body && !headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }

        const response = await fetch(path, { ...requestOptions, headers });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok) {
          const serverMessage = data && data.error ? data.error.message : "Request failed";
          throw new Error(serverMessage);
        }

        return data;
      }

      function formToObject(form) {
        const data = {};
        for (const [key, value] of new FormData(form).entries()) {
          if (typeof value === "string" && value.trim() !== "") {
            data[key] = value.trim();
          }
        }
        return data;
      }

      function statusClass(status) {
        return status === "ACTIVE" ? "status-active" : "status-inactive";
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function groupOptions(selectedId) {
        return state.groups.map(function (group) {
          const selected = selectedId === group.id ? " selected" : "";
          return "<option value=\\"" + group.id + "\\"" + selected + ">" + escapeHtml(group.name) + "</option>";
        }).join("");
      }

      function groupAvailableUserOptions(group) {
        const memberIds = new Set(group.users.map(function (entry) { return entry.user.id; }));
        const options = state.users.filter(function (user) {
          return !memberIds.has(user.id);
        });

        if (options.length === 0) {
          return "<option value=\\"\\">No users available</option>";
        }

        return options.map(function (user) {
          return "<option value=\\"" + user.id + "\\">" + escapeHtml(user.email) + "</option>";
        }).join("");
      }

      function groupAvailableApplicationOptions(group) {
        const applicationIds = new Set(group.policies.map(function (policy) { return policy.application.id; }));
        const options = state.applications.filter(function (application) {
          return !applicationIds.has(application.id);
        });

        if (options.length === 0) {
          return "<option value=\\"\\">No applications available</option>";
        }

        return options.map(function (application) {
          return "<option value=\\"" + application.id + "\\">" + escapeHtml(application.clientId) + "</option>";
        }).join("");
      }

      function renderSummary(summary) {
        document.getElementById("summary").innerHTML = [
          ["Users", summary.users.total, summary.users.active + " active"],
          ["Groups", summary.groups.total, "access groups"],
          ["Applications", summary.applications.total, summary.applications.active + " active"],
          ["Policies", summary.policies.total, "allow policies"]
        ].map(function (item) {
          return "<div class=\\"metric\\"><span>" + item[0] + "</span><strong>" + item[1] + "</strong><span>" + item[2] + "</span></div>";
        }).join("");
      }

      function renderUsers() {
        document.getElementById("users-table").innerHTML = "<div class=\\"table-wrap\\"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Groups</th><th>Actions</th></tr></thead><tbody>" +
          state.users.map(function (user) {
            const groups = user.groups.map(function (entry) { return entry.group.name; }).join(", ") || "-";
            if (state.editingUserId === user.id) {
              return "<tr><td class=\\"edit-cell\\"><input id=\\"user-name-" + user.id + "\\" value=\\"" + escapeHtml(user.name) + "\\" autocomplete=\\"off\\"></td><td class=\\"edit-cell\\"><input id=\\"user-email-" + user.id + "\\" type=\\"email\\" value=\\"" + escapeHtml(user.email) + "\\" autocomplete=\\"off\\"></td><td><select id=\\"user-status-" + user.id + "\\" class=\\"inline-select\\"><option value=\\"ACTIVE\\">Active</option><option value=\\"INACTIVE\\">Inactive</option></select></td><td>" + escapeHtml(groups) + "</td><td><div class=\\"actions\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"updateUser('" + user.id + "')\\">Save</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"cancelEditUser()\\">Cancel</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"changePassword('" + user.id + "')\\">Password</button></div></td></tr>";
            }
            return "<tr><td><div class=\\"identity\\"><strong>" + escapeHtml(user.name) + "</strong><span class=\\"muted mono\\">" + escapeHtml(user.id) + "</span></div></td><td>" + escapeHtml(user.email) + "</td><td><span class=\\"pill " + statusClass(user.status) + "\\">" + user.status + "</span></td><td>" + escapeHtml(groups) + "</td><td><div class=\\"actions\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"editUser('" + user.id + "')\\">Edit</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"changePassword('" + user.id + "')\\">Password</button></div></td></tr>";
          }).join("") +
          "</tbody></table></div>";
        for (const user of state.users) {
          const select = document.getElementById("user-status-" + user.id);
          if (select) select.value = user.status;
        }
      }

      function renderGroups() {
        document.getElementById("groups-table").innerHTML = "<div class=\\"group-list\\">" +
          state.groups.map(function (group) {
            const isEditing = state.editingGroupId === group.id;
            const members = group.users.map(function (entry) {
              return "<span class=\\"member-chip\\"><span>" + escapeHtml(entry.user.email) + "</span><button type=\\"button\\" title=\\"Remove user\\" onclick=\\"removeUserFromGroup('" + group.id + "', '" + entry.user.id + "')\\">x</button></span>";
            }).join("") || "<span class=\\"muted\\">No users in this group</span>";
            const apps = group.policies.map(function (policy) {
              return "<span class=\\"member-chip\\"><span>" + escapeHtml(policy.application.clientId) + "</span><button type=\\"button\\" title=\\"Remove application policy\\" onclick=\\"removeApplicationFromGroup('" + policy.application.id + "', '" + policy.id + "')\\">x</button></span>";
            }).join("") || "<span class=\\"muted\\">No application policies</span>";
            const addDisabled = group.users.length >= state.users.length ? " disabled" : "";
            const addApplicationDisabled = group.policies.length >= state.applications.length ? " disabled" : "";
            const groupActions = isEditing
              ? "<div class=\\"group-row\\"><span class=\\"group-row-label\\">Edit Group</span><div class=\\"group-edit\\"><input id=\\"group-name-" + group.id + "\\" value=\\"" + escapeHtml(group.name) + "\\" placeholder=\\"Group name\\" autocomplete=\\"off\\"><input id=\\"group-description-" + group.id + "\\" value=\\"" + escapeHtml(group.description || "") + "\\" placeholder=\\"Description\\" autocomplete=\\"off\\"><div class=\\"actions\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"updateGroup('" + group.id + "')\\">Save</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"cancelEditGroup()\\">Cancel</button></div></div></div>"
              : "<div class=\\"actions\\"><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"editGroup('" + group.id + "')\\">Edit</button><button type=\\"button\\" class=\\"danger small\\" onclick=\\"deleteGroup('" + group.id + "')\\">Delete</button></div>";
            const details = "<div class=\\"group-details\\"><div class=\\"group-row\\"><span class=\\"group-row-label\\">Users</span><div class=\\"group-members\\">" + members + "</div></div><div class=\\"group-row\\"><span class=\\"group-row-label\\">Add User</span><div class=\\"group-add\\"><select id=\\"group-user-" + group.id + "\\" class=\\"inline-select\\"" + addDisabled + ">" + groupAvailableUserOptions(group) + "</select><button type=\\"button\\" class=\\"small\\"" + addDisabled + " onclick=\\"addUserToGroup('" + group.id + "')\\">Add</button></div></div><div class=\\"group-row\\"><span class=\\"group-row-label\\">Applications</span><div class=\\"group-members\\">" + apps + "</div></div><div class=\\"group-row\\"><span class=\\"group-row-label\\">Add Application</span><div class=\\"group-add\\"><select id=\\"group-application-" + group.id + "\\" class=\\"inline-select\\"" + addApplicationDisabled + ">" + groupAvailableApplicationOptions(group) + "</select><button type=\\"button\\" class=\\"small\\"" + addApplicationDisabled + " onclick=\\"addApplicationToGroup('" + group.id + "')\\">Add</button></div></div>" + groupActions + "</div>";
            const open = isEditing ? " open" : "";

            return "<details class=\\"group-card\\"" + open + "><summary class=\\"group-card-head\\"><div class=\\"group-title\\"><strong>" + escapeHtml(group.name) + "</strong><span class=\\"muted\\">" + escapeHtml(group.description || "-") + "</span><div class=\\"group-meta\\"><span class=\\"pill\\">" + group.users.length + " users</span><span class=\\"pill\\">" + group.policies.length + " apps</span></div></div><span class=\\"dropdown-caret\\" aria-hidden=\\"true\\">&gt;</span></summary>" + details + "</details>";
          }).join("") +
          "</div>";
      }

      function renderApplications() {
        document.getElementById("applications-table").innerHTML = "<div class=\\"table-wrap\\"><table><thead><tr><th>Name</th><th>Client</th><th>Status</th><th>Redirect URIs</th><th>Policies</th><th>Actions</th></tr></thead><tbody>" +
          state.applications.map(function (application) {
            const redirects = application.redirectUris.map(function (entry) { return entry.redirectUri; }).join(", ") || "-";
            const policies = application.policies.map(function (policy) { return policy.group.name + " " + policy.effect; }).join(", ") || "-";
            return "<tr><td>" + escapeHtml(application.name) + "</td><td class=\\"mono\\">" + escapeHtml(application.clientId) + "</td><td><select id=\\"app-status-" + application.id + "\\" class=\\"inline-select\\"><option value=\\"ACTIVE\\">Active</option><option value=\\"INACTIVE\\">Inactive</option></select></td><td>" + escapeHtml(redirects) + "</td><td>" + escapeHtml(policies) + "</td><td><div class=\\"actions\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"updateApplicationStatus('" + application.id + "')\\">Save Status</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"addRedirectUri('" + application.id + "')\\">Redirect</button><select id=\\"app-group-" + application.id + "\\" class=\\"inline-select\\">" + groupOptions() + "</select><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"addPolicy('" + application.id + "')\\">Policy</button><button type=\\"button\\" class=\\"danger small\\" onclick=\\"deleteApplication('" + application.id + "')\\">Delete</button></div></td></tr>";
          }).join("") +
          "</tbody></table></div>";
        for (const application of state.applications) {
          const select = document.getElementById("app-status-" + application.id);
          if (select) select.value = application.status;
        }
      }

      function renderAuditLogs() {
        document.getElementById("audit-table").innerHTML = "<div class=\\"table-wrap\\"><table><thead><tr><th>Event</th><th>Result</th><th>User</th><th>Application</th><th>Time</th></tr></thead><tbody>" +
          state.auditLogs.map(function (log) {
            return "<tr><td>" + escapeHtml(log.eventType) + "</td><td>" + escapeHtml(log.result) + "</td><td class=\\"mono\\">" + escapeHtml(log.userId || "-") + "</td><td class=\\"mono\\">" + escapeHtml(log.applicationId || "-") + "</td><td>" + escapeHtml(log.createdAt) + "</td></tr>";
          }).join("") +
          "</tbody></table></div>";
      }

      async function loadAll() {
        setMessage("Loading...");
        const results = await Promise.all([
          api("/admin/summary"),
          api("/admin/users"),
          api("/admin/groups"),
          api("/admin/applications"),
          api("/admin/audit-logs?limit=20")
        ]);
        renderSummary(results[0]);
        state.users = results[1];
        state.groups = results[2];
        state.applications = results[3];
        state.auditLogs = results[4];
        renderUsers();
        renderGroups();
        renderApplications();
        renderAuditLogs();
        setMessage("Ready", "success");
      }

      async function run(action) {
        try {
          setMessage("Saving...");
          await action();
          await loadAll();
          setMessage("Saved", "success");
        } catch (error) {
          setMessage(error.message, "error");
        }
      }

      function setCreateFormVisible(formId, buttonId, visible) {
        const form = document.getElementById(formId);
        const button = document.getElementById(buttonId);
        form.hidden = !visible;
        button.textContent = visible ? "x" : "+";
        button.setAttribute("aria-expanded", String(visible));
        const title = visible ? button.dataset.openTitle : button.dataset.closedTitle;
        if (title) {
          button.setAttribute("title", title);
          button.setAttribute("aria-label", title);
        }
        if (visible) {
          const firstInput = form.querySelector("input, select");
          if (firstInput) firstInput.focus();
        }
      }

      function toggleCreateForm(formId, buttonId) {
        const form = document.getElementById(formId);
        setCreateFormVisible(formId, buttonId, form.hidden);
      }

      function editUser(id) {
        state.editingUserId = id;
        renderUsers();
      }

      function cancelEditUser() {
        state.editingUserId = null;
        renderUsers();
      }

      async function updateUser(id) {
        const name = document.getElementById("user-name-" + id).value.trim();
        const email = document.getElementById("user-email-" + id).value.trim();
        const status = document.getElementById("user-status-" + id).value;
        await run(async function () {
          await api("/admin/users/" + id, { method: "PATCH", body: JSON.stringify({ name, email, status }) });
          state.editingUserId = null;
        });
      }

      async function changePassword(id) {
        const password = prompt("New password");
        if (!password) return;
        await run(function () {
          return api("/admin/users/" + id + "/password", { method: "POST", body: JSON.stringify({ password }) });
        });
      }

      function editGroup(id) {
        state.editingGroupId = id;
        renderGroups();
      }

      function cancelEditGroup() {
        state.editingGroupId = null;
        renderGroups();
      }

      async function updateGroup(id) {
        const name = document.getElementById("group-name-" + id).value.trim();
        const description = document.getElementById("group-description-" + id).value.trim();

        if (!name) {
          setMessage("Group name wajib diisi", "error");
          return;
        }

        await run(async function () {
          await api("/admin/groups/" + id, { method: "PATCH", body: JSON.stringify({ name, description }) });
          state.editingGroupId = null;
        });
      }

      async function addUserToGroup(id) {
        const userId = document.getElementById("group-user-" + id).value;
        if (!userId) return;
        await run(function () {
          return api("/admin/groups/" + id + "/users", { method: "POST", body: JSON.stringify({ userId }) });
        });
      }

      async function removeUserFromGroup(groupId, userId) {
        await run(function () {
          return api("/admin/groups/" + groupId + "/users/" + userId, { method: "DELETE" });
        });
      }

      async function addApplicationToGroup(groupId) {
        const applicationId = document.getElementById("group-application-" + groupId).value;
        if (!applicationId) return;
        await run(function () {
          return api("/admin/applications/" + applicationId + "/policies", { method: "POST", body: JSON.stringify({ groupId }) });
        });
      }

      async function removeApplicationFromGroup(applicationId, policyId) {
        await run(function () {
          return api("/admin/applications/" + applicationId + "/policies/" + policyId, { method: "DELETE" });
        });
      }

      async function deleteGroup(id) {
        if (!confirm("Delete group?")) return;
        await run(function () {
          return api("/admin/groups/" + id, { method: "DELETE" });
        });
      }

      async function updateApplicationStatus(id) {
        const status = document.getElementById("app-status-" + id).value;
        await run(function () {
          return api("/admin/applications/" + id, { method: "PATCH", body: JSON.stringify({ status }) });
        });
      }

      async function addRedirectUri(id) {
        const redirectUri = prompt("Redirect URI");
        if (!redirectUri) return;
        await run(function () {
          return api("/admin/applications/" + id + "/redirect-uris", { method: "POST", body: JSON.stringify({ redirectUri }) });
        });
      }

      async function addPolicy(id) {
        const groupId = document.getElementById("app-group-" + id).value;
        await run(function () {
          return api("/admin/applications/" + id + "/policies", { method: "POST", body: JSON.stringify({ groupId }) });
        });
      }

      async function deleteApplication(id) {
        if (!confirm("Delete application?")) return;
        await run(function () {
          return api("/admin/applications/" + id, { method: "DELETE" });
        });
      }

      document.querySelectorAll(".tab").forEach(function (button) {
        button.addEventListener("click", function () {
          document.querySelectorAll(".tab").forEach(function (item) { item.classList.remove("active"); });
          document.querySelectorAll(".panel").forEach(function (item) { item.classList.remove("active"); });
          button.classList.add("active");
          document.getElementById(button.dataset.tab).classList.add("active");
        });
      });

      document.getElementById("user-form").addEventListener("submit", function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        run(async function () {
          await api("/admin/users", { method: "POST", body: JSON.stringify(formToObject(form)) });
          form.reset();
          setCreateFormVisible("user-form", "toggle-user-form", false);
        });
      });

      document.getElementById("group-form").addEventListener("submit", function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        run(async function () {
          await api("/admin/groups", { method: "POST", body: JSON.stringify(formToObject(form)) });
          form.reset();
          setCreateFormVisible("group-form", "toggle-group-form", false);
        });
      });

      document.getElementById("toggle-user-form").addEventListener("click", function () {
        toggleCreateForm("user-form", "toggle-user-form");
      });

      document.getElementById("toggle-group-form").addEventListener("click", function () {
        toggleCreateForm("group-form", "toggle-group-form");
      });

      document.getElementById("application-form").addEventListener("submit", function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        run(async function () {
          await api("/admin/applications", { method: "POST", body: JSON.stringify(formToObject(form)) });
          form.reset();
        });
      });

      document.getElementById("refresh-audit").addEventListener("click", function () {
        run(async function () {
          state.auditLogs = await api("/admin/audit-logs?limit=20");
          renderAuditLogs();
        });
      });

      loadAll().catch(function (error) {
        setMessage(error.message);
      });
    </script>
  </body>
</html>`;
