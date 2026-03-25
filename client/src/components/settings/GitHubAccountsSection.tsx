import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useGitHubAccounts, useCreateGitHubAccount, useDeleteGitHubAccount } from "@/hooks";
import { useConfirm } from "@/hooks/useConfirm";

export default function GitHubAccountsSection() {
  const { data: accounts } = useGitHubAccounts();
  const create = useCreateGitHubAccount();
  const deleteAccount = useDeleteGitHubAccount();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  const handleAdd = () => {
    if (!name.trim() || !token.trim()) return;
    create.mutate({ name: name.trim(), token: token.trim() }, {
      onSuccess: () => { setName(""); setToken(""); },
    });
  };

  return (
    <div className="space-y-4">
      <Label>GitHub Accounts</Label>

      {accounts?.map((acct) => (
        <div key={acct.id} className="flex items-center gap-2 p-2 border rounded">
          <span className="text-sm font-medium flex-1">{acct.name}</span>
          {acct.hasToken && <Badge variant="outline" className="text-[10px]">Token configured</Badge>}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={async () => { if (await confirm({ title: "Delete Account", description: "Delete this account?" })) deleteAccount.mutate(acct.id); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" className="flex-1" />
        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="GitHub token" className="flex-1" />
        <Button size="sm" onClick={handleAdd} disabled={!name.trim() || !token.trim() || create.isPending}>
          {create.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
          Add
        </Button>
      </div>
    </div>
  );
}
