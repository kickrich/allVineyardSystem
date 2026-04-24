Rails.application.routes.draw do
  namespace :api do
    resources :videos, only: [:create, :show, :index, :destroy] do
      post 'upload_shard', on: :member
      get 'shards/:shard_index/status', to: 'videos#shard_status', on: :member
    end
    
    resources :video_shards, only: [:destroy] do
      post 'results', on: :member
    end

    post 'missions/create', to: 'missions#create'
    post 'missions/upload_shard', to: 'missions#upload_shard'
    get 'missions/:mission_id/status', to: 'missions#status'
  end
  
  root 'dashboard#index'
  get 'video/:id', to: 'dashboard#show', as: 'video'
  delete 'video/:id', to: 'dashboard#destroy', as: 'destroy_video'
  delete 'video/:video_id/shards/:shard_id', to: 'dashboard#destroy_shard', as: 'destroy_shard'
end