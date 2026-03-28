import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 py-12 px-4 sm:px-6 lg:px-8">
      <SignIn 
        appearance={{
          elements: {
            formButtonPrimary: "bg-amber-500 hover:bg-amber-600 text-white",
            card: "shadow-xl",
            headerTitle: "text-amber-900",
            headerSubtitle: "text-amber-700",
            socialButtonsBlockButton: "border-amber-200 hover:border-amber-300",
            formFieldInput: "border-amber-200 focus:border-amber-500 focus:ring-amber-500",
            footerActionLink: "text-amber-600 hover:text-amber-700",
          },
        }}
      />
    </div>
  );
}
