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

      dialog.modal {
        width: min(560px, calc(100% - 32px));
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        padding: 0;
        box-shadow: 0 18px 48px rgb(31 41 51 / 18%);
      }

      dialog.modal::backdrop {
        background: rgb(31 41 51 / 42%);
      }

      .modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid var(--line);
        padding: 14px 16px;
      }

      .modal-body {
        padding: 16px;
      }

      .modal form.grid {
        grid-template-columns: 1fr;
        margin-bottom: 0;
      }

      .modal-actions {
        justify-content: flex-end;
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

      select {
        appearance: none;
        background-image:
          linear-gradient(45deg, transparent 50%, var(--muted) 50%),
          linear-gradient(135deg, var(--muted) 50%, transparent 50%);
        background-position:
          calc(100% - 18px) 50%,
          calc(100% - 13px) 50%;
        background-repeat: no-repeat;
        background-size: 5px 5px, 5px 5px;
        padding-right: 36px;
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
        min-width: 880px;
        border-collapse: collapse;
        table-layout: fixed;
      }

      th,
      td {
        border-top: 1px solid var(--line);
        padding: 10px 8px;
        text-align: center;
        vertical-align: middle;
        overflow-wrap: anywhere;
        word-break: break-word;
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

      .actions.end {
        justify-content: center;
      }

      .edit-panel {
        display: grid;
        gap: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #f8fafb;
        padding: 12px;
      }

      .edit-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .edit-grid.wide {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .application-edit {
        gap: 16px;
        padding: 16px;
      }

      .application-section-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        align-items: start;
      }

      .subsection {
        display: grid;
        gap: 10px;
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #ffffff;
        padding: 12px;
      }

      .subsection-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .subsection-head strong {
        font-size: 13px;
        text-transform: uppercase;
        color: var(--muted);
      }

      .inline-form,
      .uri-row {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto;
        gap: 8px;
        align-items: center;
      }

      .uri-list {
        display: grid;
        gap: 8px;
      }

      .uri-row {
        grid-template-columns: minmax(220px, 1fr) auto auto;
      }

      .application-actions {
        justify-content: flex-end;
      }

      .audit-filters {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr)) auto auto;
        gap: 10px;
        align-items: end;
        margin-bottom: 16px;
      }

      .filter-field {
        display: grid;
        gap: 5px;
        text-align: left;
      }

      .filter-field label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .audit-sections {
        display: grid;
        gap: 18px;
      }

      .audit-section {
        display: grid;
        gap: 10px;
        border-top: 1px solid var(--line);
        padding-top: 14px;
      }

      .audit-section:first-child {
        border-top: 0;
        padding-top: 0;
      }

      .audit-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }

      .audit-section-head h3 {
        margin: 0;
        font-size: 14px;
      }

      .audit-section-title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .audit-section-title button {
        min-width: 30px;
        min-height: 30px;
        padding: 0;
      }

      .audit-section-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }

      .audit-section-controls button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        min-height: 30px;
        padding: 0;
      }

      .audit-section-body[hidden] {
        display: none;
      }

      .arrow-icon {
        display: inline-block;
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
      }

      .arrow-up {
        border-bottom: 7px solid currentColor;
      }

      .arrow-down {
        border-top: 7px solid currentColor;
      }

      .arrow-right {
        border-top: 5px solid transparent;
        border-bottom: 5px solid transparent;
        border-left: 7px solid currentColor;
      }

      .identity {
        display: grid;
        justify-items: center;
        gap: 2px;
        text-align: center;
      }

      .identity strong {
        font-size: 14px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 26px;
        border-radius: 999px;
        background: #f3f5f7;
        padding: 3px 9px;
        text-align: center;
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
        width: 30px;
        min-width: 30px;
        height: 30px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
        color: var(--muted);
      }

      .dropdown-caret .arrow-down,
      .group-card[open] .dropdown-caret .arrow-right {
        display: none;
      }

      .group-card[open] .dropdown-caret .arrow-down {
        display: inline-block;
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

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
      }

      @media (max-width: 900px) {
        .summary,
        .audit-filters,
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
        .audit-filters,
        form.grid {
          grid-template-columns: 1fr;
        }

        .group-card-head {
          display: grid;
        }

        .group-add,
        .application-section-grid,
        .inline-form,
        .uri-row,
        .edit-grid,
        .edit-grid.wide {
          grid-template-columns: 1fr;
          max-width: none;
        }

        .application-actions {
          justify-content: stretch;
        }

        .application-actions button {
          width: 100%;
        }

        .audit-section-head {
          align-items: stretch;
          display: grid;
        }

        .audit-section-controls {
          justify-content: stretch;
        }

        .audit-section-controls button {
          flex: 1;
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
          <button id="open-application-dialog" class="icon-button" type="button" title="Create application" aria-label="Create application">+</button>
        </div>
        <div class="panel-body">
          <div id="applications-table"></div>
        </div>
      </section>

      <section id="audit" class="panel">
        <div class="panel-head">
          <h2>Audit Logs</h2>
          <button id="refresh-audit" class="secondary small" type="button">Refresh Logs</button>
        </div>
        <div class="panel-body">
          <form id="audit-filter-form" class="audit-filters">
            <div class="filter-field">
              <label for="audit-section-filter">Section</label>
              <select id="audit-section-filter" name="section">
                <option value="all">All sections</option>
                <option value="users">Users</option>
                <option value="groups">Groups</option>
                <option value="applications">Applications</option>
              </select>
            </div>
            <div class="filter-field">
              <label for="audit-type-filter">Type</label>
              <select id="audit-type-filter" name="eventType">
                <option value="all">All types</option>
                <option value="AdminUserCreated">AdminUserCreated</option>
                <option value="AdminUserUpdated">AdminUserUpdated</option>
                <option value="AdminUserPasswordChanged">AdminUserPasswordChanged</option>
                <option value="LoginSuccess">LoginSuccess</option>
                <option value="LoginFailed">LoginFailed</option>
                <option value="LogoutSso">LogoutSso</option>
                <option value="PasswordChanged">PasswordChanged</option>
                <option value="PasswordChangeFailed">PasswordChangeFailed</option>
                <option value="SessionRevoked">SessionRevoked</option>
                <option value="mfa_enrolled">mfa_enrolled</option>
                <option value="mfa_success">mfa_success</option>
                <option value="mfa_failed">mfa_failed</option>
                <option value="AdminGroupCreated">AdminGroupCreated</option>
                <option value="AdminGroupUpdated">AdminGroupUpdated</option>
                <option value="AdminGroupDeleted">AdminGroupDeleted</option>
                <option value="AdminGroupUserAdded">AdminGroupUserAdded</option>
                <option value="AdminGroupUserRemoved">AdminGroupUserRemoved</option>
                <option value="AccessPolicyChanged">AccessPolicyChanged</option>
                <option value="AdminApplicationCreated">AdminApplicationCreated</option>
                <option value="AdminApplicationUpdated">AdminApplicationUpdated</option>
                <option value="AdminApplicationDeleted">AdminApplicationDeleted</option>
                <option value="AdminApplicationRedirectUriCreated">AdminApplicationRedirectUriCreated</option>
                <option value="AdminApplicationRedirectUriUpdated">AdminApplicationRedirectUriUpdated</option>
                <option value="AdminApplicationRedirectUriDeleted">AdminApplicationRedirectUriDeleted</option>
                <option value="AdminApplicationPolicyCreated">AdminApplicationPolicyCreated</option>
                <option value="AdminApplicationPolicyDeleted">AdminApplicationPolicyDeleted</option>
                <option value="AuthorizationCodeIssued">AuthorizationCodeIssued</option>
                <option value="PolicyDenied">PolicyDenied</option>
                <option value="TokenIssued">TokenIssued</option>
              </select>
            </div>
            <div class="filter-field">
              <label for="audit-from-filter">From</label>
              <input id="audit-from-filter" name="from" type="datetime-local">
            </div>
            <div class="filter-field">
              <label for="audit-to-filter">To</label>
              <input id="audit-to-filter" name="to" type="datetime-local">
            </div>
            <div class="filter-field">
              <label for="audit-limit-filter">Limit</label>
              <select id="audit-limit-filter" name="limit">
                <option value="20">20</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
              </select>
            </div>
            <button type="submit" class="small">Apply</button>
            <button id="reset-audit-filter" type="button" class="secondary small">Reset</button>
          </form>
          <div id="audit-table"></div>
        </div>
      </section>
    </main>

    <dialog id="application-dialog" class="modal">
      <div class="modal-head">
        <h2>Create Application</h2>
        <button id="close-application-dialog" class="secondary icon-button" type="button" title="Close" aria-label="Close">x</button>
      </div>
      <div class="modal-body">
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
          <div class="actions modal-actions">
            <button type="submit">Create Application</button>
            <button class="secondary" id="cancel-application-form" type="button">Cancel</button>
          </div>
        </form>
      </div>
    </dialog>

    <script>
      const state = {
        users: [],
        groups: [],
        applications: [],
        auditLogs: [],
        editingUserId: null,
        editingGroupId: null,
        editingApplicationId: null,
        auditSectionOrder: ["users", "groups", "applications"],
        auditCollapsedSections: new Set()
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

      function applicationAvailableGroupOptions(application) {
        const groupIds = new Set(application.policies.map(function (policy) { return policy.group.id; }));
        const options = state.groups.filter(function (group) {
          return !groupIds.has(group.id);
        });

        if (options.length === 0) {
          return "<option value=\\"\\">No groups available</option>";
        }

        return options.map(function (group) {
          return "<option value=\\"" + group.id + "\\">" + escapeHtml(group.name) + "</option>";
        }).join("");
      }

      function renderRedirectEditor(application) {
        const rows = application.redirectUris.map(function (entry) {
          return "<div class=\\"uri-row\\"><input id=\\"redirect-uri-" + entry.id + "\\" value=\\"" + escapeHtml(entry.redirectUri) + "\\" placeholder=\\"Redirect URI\\" autocomplete=\\"off\\"><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"updateRedirectUri('" + application.id + "', '" + entry.id + "')\\">Save</button><button type=\\"button\\" class=\\"danger small\\" onclick=\\"deleteRedirectUri('" + application.id + "', '" + entry.id + "')\\">Delete</button></div>";
        }).join("") || "<span class=\\"muted\\">No redirect URIs</span>";

        return "<section class=\\"subsection\\"><div class=\\"subsection-head\\"><strong>Redirect URIs</strong></div><div class=\\"uri-list\\">" + rows + "</div><div class=\\"inline-form\\"><input id=\\"new-redirect-uri-" + application.id + "\\" placeholder=\\"New redirect URI\\" autocomplete=\\"off\\"><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"addRedirectUri('" + application.id + "')\\">Add</button></div></section>";
      }

      function renderPolicyEditor(application) {
        const policies = application.policies.map(function (policy) {
          return "<span class=\\"member-chip\\"><span>" + escapeHtml(policy.group.name + " " + policy.effect) + "</span><button type=\\"button\\" title=\\"Remove policy\\" onclick=\\"removePolicy('" + application.id + "', '" + policy.id + "')\\">x</button></span>";
        }).join("") || "<span class=\\"muted\\">No application policies</span>";
        const addDisabled = application.policies.length >= state.groups.length ? " disabled" : "";

        return "<section class=\\"subsection\\"><div class=\\"subsection-head\\"><strong>Application Access</strong></div><div class=\\"group-members\\">" + policies + "</div><div class=\\"inline-form\\"><select id=\\"app-group-" + application.id + "\\"" + addDisabled + ">" + applicationAvailableGroupOptions(application) + "</select><button type=\\"button\\" class=\\"secondary small\\"" + addDisabled + " onclick=\\"addPolicy('" + application.id + "')\\">Add Policy</button></div></section>";
      }

      function renderApplicationEditPanel(application) {
        return "<tr><td colspan=\\"6\\"><div class=\\"edit-panel application-edit\\"><div class=\\"edit-grid wide\\"><input id=\\"app-name-" + application.id + "\\" value=\\"" + escapeHtml(application.name) + "\\" placeholder=\\"Application name\\" autocomplete=\\"off\\"><input id=\\"app-client-id-" + application.id + "\\" value=\\"" + escapeHtml(application.clientId) + "\\" placeholder=\\"Client ID\\" autocomplete=\\"off\\"><input id=\\"app-client-secret-" + application.id + "\\" type=\\"password\\" placeholder=\\"New client secret\\" autocomplete=\\"off\\"><select id=\\"app-status-" + application.id + "\\"><option value=\\"ACTIVE\\">Active</option><option value=\\"INACTIVE\\">Inactive</option></select><input id=\\"app-launch-url-" + application.id + "\\" value=\\"" + escapeHtml(application.launchUrl || "") + "\\" placeholder=\\"Launch URL\\" autocomplete=\\"off\\"><input id=\\"app-logout-url-" + application.id + "\\" value=\\"" + escapeHtml(application.logoutNotificationUrl) + "\\" placeholder=\\"Logout notification URL\\" autocomplete=\\"off\\"></div><div class=\\"application-section-grid\\">" + renderRedirectEditor(application) + renderPolicyEditor(application) + "</div><div class=\\"actions application-actions\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"updateApplication('" + application.id + "')\\">Save Application</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"cancelEditApplication()\\">Cancel</button></div></div></td></tr>";
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
              return "<tr><td colspan=\\"5\\"><div class=\\"edit-panel\\"><div class=\\"edit-grid\\"><input id=\\"user-name-" + user.id + "\\" value=\\"" + escapeHtml(user.name) + "\\" placeholder=\\"Name\\" autocomplete=\\"off\\"><input id=\\"user-email-" + user.id + "\\" type=\\"email\\" value=\\"" + escapeHtml(user.email) + "\\" placeholder=\\"Email\\" autocomplete=\\"off\\"><input id=\\"user-password-" + user.id + "\\" type=\\"password\\" placeholder=\\"New password\\" autocomplete=\\"off\\"><select id=\\"user-status-" + user.id + "\\"><option value=\\"ACTIVE\\">Active</option><option value=\\"INACTIVE\\">Inactive</option></select></div><div class=\\"actions end\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"updateUser('" + user.id + "')\\">Save</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"cancelEditUser()\\">Cancel</button></div></div></td></tr>";
            }
            return "<tr><td><div class=\\"identity\\"><strong>" + escapeHtml(user.name) + "</strong><span class=\\"muted mono\\">" + escapeHtml(user.id) + "</span></div></td><td>" + escapeHtml(user.email) + "</td><td><span class=\\"pill " + statusClass(user.status) + "\\">" + user.status + "</span></td><td>" + escapeHtml(groups) + "</td><td><div class=\\"actions end\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"editUser('" + user.id + "')\\">Edit</button></div></td></tr>";
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
              ? "<div class=\\"edit-panel\\"><div class=\\"edit-grid wide\\"><input id=\\"group-name-" + group.id + "\\" value=\\"" + escapeHtml(group.name) + "\\" placeholder=\\"Group name\\" autocomplete=\\"off\\"><input id=\\"group-description-" + group.id + "\\" value=\\"" + escapeHtml(group.description || "") + "\\" placeholder=\\"Description\\" autocomplete=\\"off\\"></div><div class=\\"actions end\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"updateGroup('" + group.id + "')\\">Save</button><button type=\\"button\\" class=\\"secondary small\\" onclick=\\"cancelEditGroup()\\">Cancel</button></div></div>"
              : "<div class=\\"actions end\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"editGroup('" + group.id + "')\\">Edit</button><button type=\\"button\\" class=\\"danger small\\" onclick=\\"deleteGroup('" + group.id + "')\\">Delete</button></div>";
            const details = "<div class=\\"group-details\\"><div class=\\"group-row\\"><span class=\\"group-row-label\\">Users</span><div class=\\"group-members\\">" + members + "</div></div><div class=\\"group-row\\"><span class=\\"group-row-label\\">Add User</span><div class=\\"group-add\\"><select id=\\"group-user-" + group.id + "\\" class=\\"inline-select\\"" + addDisabled + ">" + groupAvailableUserOptions(group) + "</select><button type=\\"button\\" class=\\"small\\"" + addDisabled + " onclick=\\"addUserToGroup('" + group.id + "')\\">Add</button></div></div><div class=\\"group-row\\"><span class=\\"group-row-label\\">Applications</span><div class=\\"group-members\\">" + apps + "</div></div><div class=\\"group-row\\"><span class=\\"group-row-label\\">Add Application</span><div class=\\"group-add\\"><select id=\\"group-application-" + group.id + "\\" class=\\"inline-select\\"" + addApplicationDisabled + ">" + groupAvailableApplicationOptions(group) + "</select><button type=\\"button\\" class=\\"small\\"" + addApplicationDisabled + " onclick=\\"addApplicationToGroup('" + group.id + "')\\">Add</button></div></div>" + groupActions + "</div>";
            const open = isEditing ? " open" : "";

            return "<details class=\\"group-card\\"" + open + "><summary class=\\"group-card-head\\"><div class=\\"group-title\\"><strong>" + escapeHtml(group.name) + "</strong><span class=\\"muted\\">" + escapeHtml(group.description || "-") + "</span><div class=\\"group-meta\\"><span class=\\"pill\\">" + group.users.length + " users</span><span class=\\"pill\\">" + group.policies.length + " apps</span></div></div><span class=\\"dropdown-caret\\" aria-hidden=\\"true\\"><span class=\\"arrow-icon arrow-right\\"></span><span class=\\"arrow-icon arrow-down\\"></span></span></summary>" + details + "</details>";
          }).join("") +
          "</div>";
      }

      function renderApplications() {
        document.getElementById("applications-table").innerHTML = "<div class=\\"table-wrap\\"><table><thead><tr><th>Name</th><th>Client</th><th>Status</th><th>Redirect URIs</th><th>Policies</th><th>Actions</th></tr></thead><tbody>" +
          state.applications.map(function (application) {
            const redirects = application.redirectUris.map(function (entry) { return entry.redirectUri; }).join(", ") || "-";
            const policies = application.policies.map(function (policy) { return policy.group.name + " " + policy.effect; }).join(", ") || "-";
            if (state.editingApplicationId === application.id) {
              return renderApplicationEditPanel(application);
            }
            return "<tr><td>" + escapeHtml(application.name) + "</td><td class=\\"mono\\">" + escapeHtml(application.clientId) + "</td><td><span class=\\"pill " + statusClass(application.status) + "\\">" + application.status + "</span></td><td>" + escapeHtml(redirects) + "</td><td>" + escapeHtml(policies) + "</td><td><div class=\\"actions end\\"><button type=\\"button\\" class=\\"small\\" onclick=\\"editApplication('" + application.id + "')\\">Edit</button><button type=\\"button\\" class=\\"danger small\\" onclick=\\"deleteApplication('" + application.id + "')\\">Delete</button></div></td></tr>";
          }).join("") +
          "</tbody></table></div>";
        for (const application of state.applications) {
          const select = document.getElementById("app-status-" + application.id);
          if (select) select.value = application.status;
        }
      }

      const auditSections = [
        {
          id: "users",
          title: "Users",
          events: new Set([
            "AdminUserCreated",
            "AdminUserUpdated",
            "AdminUserPasswordChanged",
            "LoginSuccess",
            "LoginFailed",
            "LogoutSso",
            "PasswordChanged",
            "PasswordChangeFailed",
            "SessionRevoked",
            "mfa_enrolled",
            "mfa_success",
            "mfa_failed"
          ])
        },
        {
          id: "groups",
          title: "Groups",
          events: new Set([
            "AdminGroupCreated",
            "AdminGroupUpdated",
            "AdminGroupDeleted",
            "AdminGroupUserAdded",
            "AdminGroupUserRemoved"
          ])
        },
        {
          id: "applications",
          title: "Applications",
          events: new Set([
            "AccessPolicyChanged",
            "AdminApplicationCreated",
            "AdminApplicationUpdated",
            "AdminApplicationDeleted",
            "AdminApplicationRedirectUriCreated",
            "AdminApplicationRedirectUriUpdated",
            "AdminApplicationRedirectUriDeleted",
            "AdminApplicationPolicyCreated",
            "AdminApplicationPolicyDeleted",
            "AuthorizationCodeIssued",
            "PolicyDenied",
            "TokenIssued"
          ])
        }
      ];

      function loadStoredJson(key, fallback) {
        try {
          const value = window.localStorage.getItem(key);
          return value ? JSON.parse(value) : fallback;
        } catch {
          return fallback;
        }
      }

      function storeJson(key, value) {
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
          // Preference storage is optional; rendering should keep working without it.
        }
      }

      function normalizeAuditSectionOrder(order) {
        const validIds = new Set(auditSections.map(function (section) { return section.id; }));
        const normalized = [];

        if (Array.isArray(order)) {
          for (const id of order) {
            if (validIds.has(id) && !normalized.includes(id)) {
              normalized.push(id);
            }
          }
        }

        for (const section of auditSections) {
          if (!normalized.includes(section.id)) {
            normalized.push(section.id);
          }
        }

        return normalized;
      }

      function loadAuditPreferences() {
        state.auditSectionOrder = normalizeAuditSectionOrder(
          loadStoredJson("auditSectionOrder", state.auditSectionOrder)
        );
        const collapsed = loadStoredJson("auditCollapsedSections", []);
        state.auditCollapsedSections = new Set(
          Array.isArray(collapsed)
            ? collapsed.filter(function (id) {
                return auditSections.some(function (section) { return section.id === id; });
              })
            : []
        );
      }

      function saveAuditPreferences() {
        storeJson("auditSectionOrder", state.auditSectionOrder);
        storeJson("auditCollapsedSections", [...state.auditCollapsedSections]);
      }

      function orderedAuditSections() {
        const sectionsById = new Map(auditSections.map(function (section) {
          return [section.id, section];
        }));

        return state.auditSectionOrder
          .map(function (id) { return sectionsById.get(id); })
          .filter(Boolean);
      }

      loadAuditPreferences();

      function auditSectionForLog(log) {
        for (const section of auditSections) {
          if (section.events.has(log.eventType)) {
            return section.id;
          }
        }

        if (log.applicationId) {
          return "applications";
        }

        return "users";
      }

      function auditQueryString() {
        const params = new URLSearchParams();
        const section = document.getElementById("audit-section-filter").value;
        const eventType = document.getElementById("audit-type-filter").value;
        const from = document.getElementById("audit-from-filter").value;
        const to = document.getElementById("audit-to-filter").value;
        const limit = document.getElementById("audit-limit-filter").value;

        params.set("limit", limit || "50");

        if (section && section !== "all") {
          params.set("section", section);
        }

        if (eventType && eventType !== "all") {
          params.set("eventType", eventType);
        }

        if (from) {
          params.set("from", from);
        }

        if (to) {
          params.set("to", to);
        }

        return params.toString();
      }

      async function loadAuditLogs() {
        state.auditLogs = await api("/admin/audit-logs?" + auditQueryString());
      }

      function renderAuditRows(logs) {
        if (logs.length === 0) {
          return "<tr><td colspan=\\"5\\" class=\\"muted\\">No audit logs</td></tr>";
        }

        return logs.map(function (log) {
          return "<tr><td>" + escapeHtml(log.eventType) + "</td><td>" + escapeHtml(log.result) + "</td><td class=\\"mono\\">" + escapeHtml(log.userId || "-") + "</td><td class=\\"mono\\">" + escapeHtml(log.applicationId || "-") + "</td><td>" + escapeHtml(log.createdAt) + "</td></tr>";
        }).join("");
      }

      function renderAuditSection(section, logs) {
        const collapsed = state.auditCollapsedSections.has(section.id);
        const orderIndex = state.auditSectionOrder.indexOf(section.id);
        const upDisabled = orderIndex <= 0 ? " disabled" : "";
        const downDisabled = orderIndex >= state.auditSectionOrder.length - 1 ? " disabled" : "";
        const bodyHidden = collapsed ? " hidden" : "";
        const toggleIcon = collapsed ? "arrow-right" : "arrow-down";

        return "<section class=\\"audit-section\\"><div class=\\"audit-section-head\\"><div class=\\"audit-section-title\\"><button type=\\"button\\" class=\\"secondary small\\" title=\\"Toggle section\\" aria-label=\\"Toggle " + section.title + "\\" onclick=\\"toggleAuditSection('" + section.id + "')\\"><span class=\\"arrow-icon " + toggleIcon + "\\" aria-hidden=\\"true\\"></span></button><h3>" + section.title + "</h3></div><div class=\\"audit-section-controls\\"><span class=\\"pill\\">" + logs.length + " logs</span><button type=\\"button\\" class=\\"secondary small\\"" + upDisabled + " title=\\"Move section up\\" aria-label=\\"Move " + section.title + " up\\" onclick=\\"moveAuditSection('" + section.id + "', -1)\\"><span class=\\"arrow-icon arrow-up\\" aria-hidden=\\"true\\"></span></button><button type=\\"button\\" class=\\"secondary small\\"" + downDisabled + " title=\\"Move section down\\" aria-label=\\"Move " + section.title + " down\\" onclick=\\"moveAuditSection('" + section.id + "', 1)\\"><span class=\\"arrow-icon arrow-down\\" aria-hidden=\\"true\\"></span></button></div></div><div class=\\"audit-section-body\\"" + bodyHidden + "><div class=\\"table-wrap\\"><table><thead><tr><th>Event</th><th>Result</th><th>User</th><th>Application</th><th>Time</th></tr></thead><tbody>" + renderAuditRows(logs) + "</tbody></table></div></div></section>";
      }

      function renderAuditLogs() {
        const selectedSection = document.getElementById("audit-section-filter").value;
        const sectionsToRender = selectedSection === "all"
          ? orderedAuditSections()
          : orderedAuditSections().filter(function (section) { return section.id === selectedSection; });

        document.getElementById("audit-table").innerHTML = "<div class=\\"audit-sections\\">" +
          sectionsToRender.map(function (section) {
            const logs = state.auditLogs.filter(function (log) {
              return auditSectionForLog(log) === section.id;
            });

            return renderAuditSection(section, logs);
          }).join("") +
          "</div>";
      }

      function toggleAuditSection(sectionId) {
        if (state.auditCollapsedSections.has(sectionId)) {
          state.auditCollapsedSections.delete(sectionId);
        } else {
          state.auditCollapsedSections.add(sectionId);
        }

        saveAuditPreferences();
        renderAuditLogs();
      }

      function moveAuditSection(sectionId, direction) {
        const order = normalizeAuditSectionOrder(state.auditSectionOrder);
        const index = order.indexOf(sectionId);
        const targetIndex = index + direction;

        if (index < 0 || targetIndex < 0 || targetIndex >= order.length) {
          return;
        }

        const target = order[targetIndex];
        order[targetIndex] = order[index];
        order[index] = target;
        state.auditSectionOrder = order;
        saveAuditPreferences();
        renderAuditLogs();
      }

      async function loadAll() {
        setMessage("Loading...");
        const results = await Promise.all([
          api("/admin/summary"),
          api("/admin/users"),
          api("/admin/groups"),
          api("/admin/applications")
        ]);
        renderSummary(results[0]);
        state.users = results[1];
        state.groups = results[2];
        state.applications = results[3];
        await loadAuditLogs();
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

      function openApplicationDialog() {
        const dialog = document.getElementById("application-dialog");
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }
        const firstInput = dialog.querySelector("input, select");
        if (firstInput) firstInput.focus();
      }

      function closeApplicationDialog() {
        const dialog = document.getElementById("application-dialog");
        const form = document.getElementById("application-form");
        form.reset();
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
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
        const password = document.getElementById("user-password-" + id).value.trim();
        const status = document.getElementById("user-status-" + id).value;
        await run(async function () {
          await api("/admin/users/" + id, { method: "PATCH", body: JSON.stringify({ name, email, status }) });
          if (password) {
            await api("/admin/users/" + id + "/password", { method: "POST", body: JSON.stringify({ password }) });
          }
          state.editingUserId = null;
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

      function editApplication(id) {
        state.editingApplicationId = id;
        renderApplications();
      }

      function cancelEditApplication() {
        state.editingApplicationId = null;
        renderApplications();
      }

      async function updateApplication(id) {
        const name = document.getElementById("app-name-" + id).value.trim();
        const clientId = document.getElementById("app-client-id-" + id).value.trim();
        const clientSecret = document.getElementById("app-client-secret-" + id).value.trim();
        const status = document.getElementById("app-status-" + id).value;
        const launchUrl = document.getElementById("app-launch-url-" + id).value.trim();
        const logoutNotificationUrl = document.getElementById("app-logout-url-" + id).value.trim();
        const payload = { name, clientId, status, launchUrl, logoutNotificationUrl };

        if (!name || !clientId || !logoutNotificationUrl) {
          setMessage("Application name, client ID, dan logout notification URL wajib diisi", "error");
          return;
        }

        if (clientSecret) {
          payload.clientSecret = clientSecret;
        }

        await run(async function () {
          await api("/admin/applications/" + id, { method: "PATCH", body: JSON.stringify(payload) });
          state.editingApplicationId = null;
        });
      }

      async function addRedirectUri(id) {
        const input = document.getElementById("new-redirect-uri-" + id);
        const redirectUri = input.value.trim();

        if (!redirectUri) {
          setMessage("Redirect URI wajib diisi", "error");
          return;
        }

        await run(function () {
          return api("/admin/applications/" + id + "/redirect-uris", { method: "POST", body: JSON.stringify({ redirectUri }) });
        });
      }

      async function updateRedirectUri(applicationId, redirectUriId) {
        const redirectUri = document.getElementById("redirect-uri-" + redirectUriId).value.trim();

        if (!redirectUri) {
          setMessage("Redirect URI wajib diisi", "error");
          return;
        }

        await run(function () {
          return api("/admin/applications/" + applicationId + "/redirect-uris/" + redirectUriId, { method: "PATCH", body: JSON.stringify({ redirectUri }) });
        });
      }

      async function deleteRedirectUri(applicationId, redirectUriId) {
        await run(function () {
          return api("/admin/applications/" + applicationId + "/redirect-uris/" + redirectUriId, { method: "DELETE" });
        });
      }

      async function addPolicy(id) {
        const groupId = document.getElementById("app-group-" + id).value;
        if (!groupId) return;
        await run(function () {
          return api("/admin/applications/" + id + "/policies", { method: "POST", body: JSON.stringify({ groupId }) });
        });
      }

      async function removePolicy(applicationId, policyId) {
        await run(function () {
          return api("/admin/applications/" + applicationId + "/policies/" + policyId, { method: "DELETE" });
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

      document.getElementById("open-application-dialog").addEventListener("click", function () {
        openApplicationDialog();
      });

      document.getElementById("close-application-dialog").addEventListener("click", function () {
        closeApplicationDialog();
      });

      document.getElementById("cancel-application-form").addEventListener("click", function () {
        closeApplicationDialog();
      });

      document.getElementById("application-form").addEventListener("submit", function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        run(async function () {
          await api("/admin/applications", { method: "POST", body: JSON.stringify(formToObject(form)) });
          closeApplicationDialog();
        });
      });

      document.getElementById("refresh-audit").addEventListener("click", function () {
        run(async function () {
          await loadAuditLogs();
          renderAuditLogs();
        });
      });

      document.getElementById("audit-filter-form").addEventListener("submit", function (event) {
        event.preventDefault();
        run(async function () {
          await loadAuditLogs();
          renderAuditLogs();
        });
      });

      document.getElementById("reset-audit-filter").addEventListener("click", function () {
        const form = document.getElementById("audit-filter-form");
        form.reset();
        run(async function () {
          await loadAuditLogs();
          renderAuditLogs();
        });
      });

      loadAll().catch(function (error) {
        setMessage(error.message);
      });
    </script>
  </body>
</html>`;
