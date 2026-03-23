export default function Help() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Help</h1>
      <div className="space-y-4">
        <section>
          <h2 className="text-lg font-semibold mb-2">Keyboard Shortcuts</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-4 py-2">Shortcut</th>
                  <th className="text-left px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-4 py-2"><kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+K</kbd></td>
                  <td className="px-4 py-2">Command Palette</td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-2"><kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+Shift+F</kbd></td>
                  <td className="px-4 py-2">Global Search</td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-2"><kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+Shift+G</kbd></td>
                  <td className="px-4 py-2">File Content Search</td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-2"><kbd className="px-2 py-0.5 bg-muted rounded text-xs">1-9</kbd></td>
                  <td className="px-4 py-2">Switch tabs</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
