{
  description = "Retell HIPAA Demo - FreePBX Terraform Infrastructure";

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

            # Useful utilities
            jq
          ];

          shellHook = ''
            echo "🏗️  retell-hipaa-demo dev environment loaded"
            echo "   terraform $(terraform version -json | jq -r '.terraform_version')"
            echo "   aws $(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1)"
          '';
        };
      }
    );
}
