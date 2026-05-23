Rails.application.routes.draw do
  mount Rswag::Api::Engine => '/api-docs'
  mount Rswag::Ui::Engine => '/api-docs'

  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      post "auth/login", to: "auth#login"

      resources :drones
      resources :drone_logs, only: [:index, :create]
      
      resources :missions do
        member do
          post :start
          post :complete
          get :ai_result
          get :processing_status
          delete :ai_result, action: :destroy_ai_result
        end
        collection do
          delete :ai_results, action: :destroy_all_ai_results
        end
      end

      
      resources :routes, only: [:create, :index, :show]
      
      
      resources :telemetries, only: [:create, :index, :show, :update, :destroy]
      
      resources :media_uploads, only: [:create, :index, :show, :update, :destroy] do
        collection do
          post :presign
          post :complete
          post :multipart_init
          post :multipart_presign_part
          get :multipart_list_parts
          post :multipart_complete
          post :multipart_abort
          post :resumable_init
          post :resumable_upload_part
          post :resumable_complete
        end
      end

      # Endpoint для получения результатов от VineyardApp
      post '/vineyard_app/results', to: 'vineyard_app#results'

      resources :users
      
      resources :zones
      resources :route_templates, only: [:index, :show, :create, :update, :destroy]
    end
  end
end