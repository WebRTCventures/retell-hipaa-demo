{
  description = "Retell HIPAA Demo - FreePBX Infrastructure + Custom LLM Server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfreePredicate = pkg:
            builtins.elem (nixpkgs.lib.getName pkg) [
              "terraform"
              "ngrok"
            ];
        };
      in
      {
        devShells.default = pkgs.mkShell {
          name = "retell-hipaa-demo";

          packages = with pkgs; [
            # Infrastructure as Code
            terraform
            terraform-docs

            # AWS CLI for managing resources and key pairs
            awscli2

            # Node.js / TypeScript (Custom LLM Server)
            nodejs_22
            # npm is bundled with nodejs_22

            # Useful utilities
            jq
            ngrok
          ];

          shellHook = ''
            echo "🏗️  retell-hipaa-demo dev environment loaded"
            echo "   terraform $(terraform version -json | jq -r '.terraform_version')"
            echo "   node     $(node --version)"
            echo "   npm      $(npm --version)"
            echo "   aws      $(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1)"
          '';
        };
      }
    );
}
